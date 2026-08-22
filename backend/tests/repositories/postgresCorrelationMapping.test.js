'use strict';

// P_CORR_1a — PostgresCorrelationRepository: Mapping + Query-Vertrag OHNE echte DB
// (pool/query gemockt). Live-Verhalten deckt die geguardete Integrationssuite ab.

jest.mock('../../src/db/pool', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return {
    query: jest.fn(),
    pool: { connect: jest.fn(async () => client) },
    __client: client,
  };
});

const poolMod = require('../../src/db/pool');
const { query, pool } = poolMod;
const { PostgresCorrelationRepository } = require('../../src/repositories/PostgresCorrelationRepository');

const repo = new PostgresCorrelationRepository();

describe('PostgresCorrelationRepository — Mapping', () => {
  test('_rowToJob: snake_case → camelCase + Date → ISO', () => {
    const row = {
      id: 'J1', ticket_id: 'T1', input_hash: 'h', source_revision: 'r', engine_version: 'ce-1',
      status: 'running', retry_count: 2, failure_reason: null, result_reference: null,
      created_at: new Date('2026-06-21T00:00:00.000Z'),
      started_at: new Date('2026-06-21T00:01:00.000Z'), completed_at: null,
    };
    expect(repo._rowToJob(row)).toEqual({
      id: 'J1', ticketId: 'T1', inputHash: 'h', sourceRevision: 'r', engineVersion: 'ce-1',
      status: 'running', retryCount: 2, failureReason: null, resultReference: null,
      createdAt: '2026-06-21T00:00:00.000Z', startedAt: '2026-06-21T00:01:00.000Z', completedAt: null,
    });
  });

  test('_rowToResult: jsonb-String wird geparst + evidenceRefs angehängt', () => {
    const row = {
      id: 'R1', ticket_id: 'T1', job_id: 'J1', input_hash: 'h', source_revision: 'r',
      engine_version: 'ce-1', result: '{"merged":true}', created_at: new Date('2026-06-21T00:00:00.000Z'),
    };
    const out = repo._rowToResult(row, [{ ticketId: 'T2', role: 'child', evidenceId: null }]);
    expect(out.result).toEqual({ merged: true });
    expect(out.evidenceRefs).toHaveLength(1);
    expect(out.createdAt).toBe('2026-06-21T00:00:00.000Z');
  });
});

describe('PostgresCorrelationRepository — findSchedulableJobs', () => {
  beforeEach(() => query.mockReset());

  test('selektiert pending|retrying, älteste zuerst, gedeckelt + parametrisiert', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.findSchedulableJobs({ limit: 50 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status IN \('pending','retrying'\)/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
    expect(sql).toMatch(/LIMIT \$1/);
    expect(params).toEqual([50]);
  });

  test('limit ist gedeckelt (kein unbounded)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.findSchedulableJobs({ limit: 99999 });
    expect(query.mock.calls[0][1]).toEqual([1000]);
  });
});

describe('PostgresCorrelationRepository — createJob Idempotenz-Konflikt', () => {
  beforeEach(() => query.mockReset());

  test('Unique-Violation (23505) → ACTIVE_INPUT_CONFLICT mit bestehendem Job', async () => {
    const dup = new Error('duplicate'); dup.code = '23505';
    query
      .mockRejectedValueOnce(dup) // INSERT scheitert am Partial-Unique-Index
      .mockResolvedValueOnce({ rows: [{
        id: 'EXIST', ticket_id: 'T1', input_hash: 'h', source_revision: 'r', engine_version: 'ce-1',
        status: 'running', retry_count: 0, failure_reason: null, result_reference: null,
        created_at: new Date(), started_at: null, completed_at: null,
      }] });

    await expect(repo.createJob({
      id: 'J2', ticketId: 'T1', inputHash: 'h', sourceRevision: 'r', engineVersion: 'ce-1',
      status: 'pending', retryCount: 0, createdAt: '2026-06-21T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'ACTIVE_INPUT_CONFLICT', existing: expect.objectContaining({ id: 'EXIST' }) });
  });
});

describe('PostgresCorrelationRepository — saveResult Transaktion', () => {
  test('BEGIN → INSERT result + INSERT evidence → COMMIT, danach release', async () => {
    const client = poolMod.__client;
    client.query.mockReset().mockResolvedValue({ rows: [] });
    client.release.mockReset();

    await repo.saveResult({
      id: 'R1', ticketId: 'T1', jobId: 'J1', inputHash: 'h', sourceRevision: 'r', engineVersion: 'ce-1',
      result: { merged: true },
      evidenceRefs: [{ ticketId: 'T2', role: 'child', evidenceId: null }],
      createdAt: '2026-06-21T00:00:00.000Z',
    });

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => /INSERT INTO correlation_results/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO correlation_result_evidence/.test(s))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('Fehler im Insert → ROLLBACK + release (kein Teil-Result)', async () => {
    const client = poolMod.__client;
    const boom = new Error('insert failed');
    client.query.mockReset();
    client.query.mockResolvedValue({ rows: [] });           // Default (u.a. ROLLBACK)
    client.query
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockRejectedValueOnce(boom);                         // erster INSERT scheitert
    client.release.mockReset();

    await expect(repo.saveResult({
      id: 'R2', ticketId: 'T1', inputHash: 'h', sourceRevision: 'r', engineVersion: 'ce-1',
      result: {}, evidenceRefs: [], createdAt: 'x',
    })).rejects.toThrow('insert failed');

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
