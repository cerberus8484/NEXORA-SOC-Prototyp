'use strict';

// P_CORR_1a — InMemory-Correlation-Repo: Idempotenz + Job-Lebenszyklus + Result-Persistenz.

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { CorrelationJob, CorrelationResult } = require('../../src/correlation/correlationJobDomain');

let repo;
beforeEach(() => { repo = new InMemoryCorrelationRepository(); });

describe('InMemoryCorrelationRepository — Jobs', () => {
  test('createJob + findJobById', async () => {
    const job = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    await repo.createJob(job.toJSON());
    const found = await repo.findJobById(job.id);
    expect(found.ticketId).toBe('T-1');
    expect(found.status).toBe('pending');
  });

  test('findActiveJobByInputHash findet nur aktive Jobs', async () => {
    const job = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    await repo.createJob(job.toJSON());
    expect((await repo.findActiveJobByInputHash(job.inputHash)).id).toBe(job.id);

    job.start(); job.complete('res-1');
    await repo.updateJob(job.toJSON());
    expect(await repo.findActiveJobByInputHash(job.inputHash)).toBeNull(); // completed = nicht aktiv
  });

  test('zweiter aktiver Job mit gleichem inputHash → ACTIVE_INPUT_CONFLICT (Idempotenz)', async () => {
    const a = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    const b = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' }); // gleicher inputHash
    expect(a.inputHash).toBe(b.inputHash);
    await repo.createJob(a.toJSON());
    await expect(repo.createJob(b.toJSON())).rejects.toMatchObject({ code: 'ACTIVE_INPUT_CONFLICT' });
  });

  test('nach completed ist ein neuer Job mit gleichem inputHash erlaubt (Recompute)', async () => {
    const a = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    await repo.createJob(a.toJSON());
    a.start(); a.complete('res');
    await repo.updateJob(a.toJSON());

    const b = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    await expect(repo.createJob(b.toJSON())).resolves.toMatchObject({ id: b.id });
  });

  test('updateJob persistiert Statuswechsel + Zähler', async () => {
    const job = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev-1' });
    await repo.createJob(job.toJSON());
    job.start(); job.retry('Timeout');
    await repo.updateJob(job.toJSON());
    const found = await repo.findJobById(job.id);
    expect(found.status).toBe('retrying');
    expect(found.retryCount).toBe(1);
    expect(found.failureReason).toMatch(/Timeout/);
  });
});

describe('InMemoryCorrelationRepository — Results', () => {
  test('saveResult + findLatestResultByTicket + findResultByInputHash (mit Evidence-Refs)', async () => {
    const result = new CorrelationResult({
      ticketId: 'T-1', jobId: 'J-1', inputHash: 'h-1', sourceRevision: 'rev-1',
      result: { merged: true },
      evidenceRefs: [{ ticketId: 'T-1', role: 'subject' }, { ticketId: 'T-2', role: 'child', evidenceId: 'E-1' }],
    });
    await repo.saveResult(result.toJSON());

    const byTicket = await repo.findLatestResultByTicket('T-1');
    expect(byTicket.result).toEqual({ merged: true });
    expect(byTicket.evidenceRefs).toHaveLength(2);                 // vollständiger Rückverweis
    expect(byTicket.evidenceRefs[1].evidenceId).toBe('E-1');

    expect((await repo.findResultByInputHash('h-1')).id).toBe(result.id);
  });

  test('findLatestResultByTicket liefert das neueste Result', async () => {
    const older = new CorrelationResult({ ticketId: 'T-1', inputHash: 'h1', sourceRevision: 'r1', result: {}, createdAt: '2026-06-21T00:00:00.000Z' });
    const newer = new CorrelationResult({ ticketId: 'T-1', inputHash: 'h2', sourceRevision: 'r2', result: {}, createdAt: '2026-06-21T01:00:00.000Z' });
    await repo.saveResult(older.toJSON());
    await repo.saveResult(newer.toJSON());
    expect((await repo.findLatestResultByTicket('T-1')).id).toBe(newer.id);
  });
});

describe('correlationRepositoryFactory', () => {
  test('ohne DB_ENABLED → InMemory-Repo', () => {
    jest.resetModules();
    const prev = process.env.DB_ENABLED;
    delete process.env.DB_ENABLED;
    try {
      const { createCorrelationRepository } = require('../../src/repositories/correlationRepositoryFactory');
      const { InMemoryCorrelationRepository: InMem } = require('../../src/repositories/InMemoryCorrelationRepository');
      expect(createCorrelationRepository()).toBeInstanceOf(InMem);
    } finally {
      if (prev !== undefined) process.env.DB_ENABLED = prev;
      jest.resetModules();
    }
  });
});
