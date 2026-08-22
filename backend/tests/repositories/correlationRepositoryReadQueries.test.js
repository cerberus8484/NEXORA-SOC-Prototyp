'use strict';

// P_CORR_ADMIN_1 Phase 1b — additive, read-only Registry-Queries auf den
// Correlation-Repos (Parität InMemory ↔ Postgres). Reines Lesen, bounded Limits,
// KEINE Pipeline-Änderung. Postgres deckt den SQL-/Param-Vertrag ohne echte DB ab.

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { CorrelationJob, CorrelationResult } = require('../../src/correlation/correlationJobDomain');

// ── InMemory: echtes Verhalten ──────────────────────────────────────────────

describe('InMemoryCorrelationRepository — listJobs / countJobsByStatus', () => {
  let repo;
  beforeEach(async () => {
    repo = new InMemoryCorrelationRepository();
    // 3 pending + 1 completed + 1 superseded-as-failed
    for (let i = 0; i < 3; i++) {
      const j = CorrelationJob.create({ ticketId: `T-${i}`, sourceRevision: `r-${i}` });
      await repo.createJob(j.toJSON());
    }
    const done = CorrelationJob.create({ ticketId: 'T-done', sourceRevision: 'r-done' });
    await repo.createJob(done.toJSON());
    done.start(); done.complete('res-done');
    await repo.updateJob(done.toJSON());

    const sup = CorrelationJob.create({ ticketId: 'T-sup', sourceRevision: 'r-sup' });
    await repo.createJob(sup.toJSON());
    sup.start(); sup.fail('superseded: source_revision geändert (r-sup → r-new)');
    await repo.updateJob(sup.toJSON());
  });

  test('listJobs ohne Filter liefert alle, newest first', async () => {
    const jobs = await repo.listJobs();
    expect(jobs).toHaveLength(5);
    for (let i = 1; i < jobs.length; i++) {
      expect(jobs[i - 1].createdAt >= jobs[i].createdAt).toBe(true);
    }
  });

  test('listJobs filtert nach Status', async () => {
    const pending = await repo.listJobs({ status: 'pending' });
    expect(pending).toHaveLength(3);
    expect(pending.every((j) => j.status === 'pending')).toBe(true);
  });

  test('listJobs respektiert limit + offset (bounded)', async () => {
    const page1 = await repo.listJobs({ limit: 2, offset: 0 });
    const page2 = await repo.listJobs({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  test('listJobs deckelt überzogene Limits', async () => {
    const jobs = await repo.listJobs({ limit: 99999 });
    expect(jobs.length).toBeLessThanOrEqual(5);
  });

  test('countJobsByStatus liefert vollständige Status-Verteilung', async () => {
    const counts = await repo.countJobsByStatus();
    expect(counts.pending).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1); // superseded ist DB-seitig failed; Ableitung passiert in der View
  });
});

describe('InMemoryCorrelationRepository — listResults', () => {
  test('listResults liefert Results newest first, bounded, OHNE Crash bei leer', async () => {
    const repo = new InMemoryCorrelationRepository();
    expect(await repo.listResults()).toEqual([]);
    const a = new CorrelationResult({ ticketId: 'T-1', inputHash: 'h1', sourceRevision: 'r1', result: {}, createdAt: '2026-06-21T00:00:00.000Z' });
    const b = new CorrelationResult({ ticketId: 'T-1', inputHash: 'h2', sourceRevision: 'r2', result: {}, createdAt: '2026-06-21T02:00:00.000Z' });
    await repo.saveResult(a.toJSON());
    await repo.saveResult(b.toJSON());
    const results = await repo.listResults({ limit: 10 });
    expect(results[0].id).toBe(b.id); // newest first
    expect(results).toHaveLength(2);
  });
});

// ── Postgres: SQL-/Param-Vertrag ohne echte DB ──────────────────────────────

jest.mock('../../src/db/pool', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const { query } = require('../../src/db/pool');
const { PostgresCorrelationRepository } = require('../../src/repositories/PostgresCorrelationRepository');

describe('PostgresCorrelationRepository — Read-Queries (SQL-Vertrag)', () => {
  const repo = new PostgresCorrelationRepository();
  beforeEach(() => query.mockReset());

  test('listJobs ohne Status: ORDER BY created_at DESC, LIMIT/OFFSET parametrisiert', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.listJobs({ limit: 25, offset: 10 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(params).toEqual([25, 10]);
  });

  test('listJobs mit Status filtert parametrisiert (kein String-Concat)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.listJobs({ status: 'failed', limit: 10, offset: 0 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE status = \$1/);
    expect(params[0]).toBe('failed');
  });

  test('listJobs deckelt das Limit (bounded)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.listJobs({ limit: 99999, offset: 0 });
    expect(query.mock.calls[0][1][0]).toBeLessThanOrEqual(200);
  });

  test('countJobsByStatus: GROUP BY status', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'pending', count: 3 }, { status: 'completed', count: 1 }] });
    const counts = await repo.countJobsByStatus();
    expect(query.mock.calls[0][0]).toMatch(/GROUP BY status/);
    expect(counts.pending).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(0); // fehlende Status werden zu 0 normalisiert
  });

  test('listResults: ORDER BY created_at DESC, bounded — KEIN result-Payload geladen wird übergroß', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repo.listResults({ limit: 5, offset: 0 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM correlation_results/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual([5, 0]);
  });
});
