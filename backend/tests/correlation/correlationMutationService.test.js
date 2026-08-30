'use strict';

const makeEvidenceRow = (overrides = {}) => ({
  id: 'E-1',
  ticket_id: 'T-1',
  payload_id: null,
  type: 'other',
  source: 'manual',
  title: 'Evidence',
  log_source: '',
  event_id: '',
  query: '',
  raw_text: 'raw',
  event_timestamp: null,
  confidence: null,
  comment: '',
  collected_by: 'analyst@nexora.example',
  collected_at: new Date('2026-06-21T10:00:00.000Z'),
  created_at: new Date('2026-06-21T10:00:00.000Z'),
  sha256: 'a'.repeat(64),
  ...overrides,
});

const makeJobRow = (overrides = {}) => ({
  id: 'J-1',
  ticket_id: 'T-1',
  input_hash: 'h',
  source_revision: '2026-06-21T10:01:00.000Z',
  engine_version: 'ce-1',
  status: 'pending',
  retry_count: 0,
  failure_reason: null,
  result_reference: null,
  created_at: new Date('2026-06-21T10:01:00.000Z'),
  started_at: null,
  completed_at: null,
  ...overrides,
});

describe('CorrelationMutationService â€” transaktionale Evidence-Mutation', () => {
  let client;
  let notifyQueue;

  beforeEach(() => {
    jest.resetModules();
    client = { query: jest.fn(), release: jest.fn() };
    notifyQueue = jest.fn(async () => true);

    jest.doMock('../../src/config', () => ({ db: { enabled: true }, log: { level: 'silent' } }));
    jest.doMock('../../src/db/pool', () => ({
      pool: { connect: jest.fn(async () => client) },
      query: jest.fn(),
    }));
  });

  function service() {
    const { CorrelationMutationService } = require('../../src/correlation/CorrelationMutationService');
    return new CorrelationMutationService({
      runtimeFactory: () => ({
        queue: { enqueue: jest.fn(async () => 'qid') },
        queueName: 'correlation.process',
        scheduler: { notifyQueue },
      }),
    });
  }

  test('Evidence create touched das Ticket, legt persistenten Job an, committet und queued danach', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT evidence
      .mockResolvedValueOnce({ rows: [makeEvidenceRow()] }) // SELECT evidence
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ updated_at: new Date('2026-06-21T10:01:00.000Z') }] }) // touch ticket
      .mockResolvedValueOnce({ rows: [] }) // find active job
      .mockResolvedValueOnce({ rows: [makeJobRow()] }) // insert job
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await service().addEvidence({ ticketId: 'T-1', title: 'Evidence', rawText: 'raw' });

    expect(result.ok).toBe(true);
    expect(result.correlation.scheduled).toBe(true);
    expect(notifyQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'J-1' }), expect.any(String));

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((sql) => /INSERT INTO evidence/.test(sql))).toBe(true);
    expect(sqls.some((sql) => /UPDATE tickets SET updated_at = NOW\(\)/.test(sql))).toBe(true);
    expect(sqls.some((sql) => /INSERT INTO correlation_jobs/.test(sql))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  test('Job-Persistenzfehler rollt Evidence-Mutation zurueck und queued nicht', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT evidence
      .mockResolvedValueOnce({ rows: [makeEvidenceRow()] }) // SELECT evidence
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ updated_at: new Date('2026-06-21T10:01:00.000Z') }] })
      .mockResolvedValueOnce({ rows: [] }) // find active job
      .mockRejectedValueOnce(new Error('correlation insert failed')) // insert job
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(service().addEvidence({ ticketId: 'T-1', title: 'Evidence', rawText: 'raw' }))
      .rejects.toThrow('correlation insert failed');

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(notifyQueue).not.toHaveBeenCalled();
  });

  test('Queue-Enqueue-Fehler nach Commit laesst Mutation und pending Job bestehen', async () => {
    notifyQueue.mockResolvedValueOnce(false);
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT evidence
      .mockResolvedValueOnce({ rows: [makeEvidenceRow()] }) // SELECT evidence
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ updated_at: new Date('2026-06-21T10:01:00.000Z') }] })
      .mockResolvedValueOnce({ rows: [] }) // find active job
      .mockResolvedValueOnce({ rows: [makeJobRow()] }) // insert job
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await service().addEvidence({ ticketId: 'T-1', title: 'Evidence', rawText: 'raw' });

    expect(result.ok).toBe(true);
    expect(result.correlation.enqueued).toBe(false);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });
});
