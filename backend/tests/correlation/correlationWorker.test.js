'use strict';

// P_CORR_1b — CorrelationWorker-Orchestrierung, ohne HTTP/echte DB (InMemory-Repo + Stubs).

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { InMemoryQueueService } = require('../../src/queue/InMemoryQueueService');
const { CorrelationWorker } = require('../../src/correlation/CorrelationWorker');
const { CorrelationJob, CorrelationResult } = require('../../src/correlation/correlationJobDomain');

const makeTicket = (id, rev, kind = 'alert') => ({ id, kind, updatedAt: rev, raw: `evt-${id}` });
const msg = (id) => ({ data: { correlationJobId: id } });

let repo;
let engine;
let tickets;
let queue;
let worker;

beforeEach(() => {
  repo = new InMemoryCorrelationRepository();
  engine = { correlate: jest.fn(() => ({ merged: true })) };
  tickets = {
    getById:      jest.fn(async (id) => makeTicket(id, 'rev1')),
    findChildren: jest.fn(async () => []),
    getRevision:  jest.fn(async () => 'rev1'),
  };
  queue = { registerWorker: jest.fn(async () => {}) };
  worker = new CorrelationWorker({ repo, queue, engine, tickets, queueName: 'correlation.process', maxRetries: 3 });
});

async function seedJob({ ticketId = 'T-1', sourceRevision = 'rev1' } = {}) {
  const job = CorrelationJob.create({ ticketId, sourceRevision });
  await repo.createJob(job.toJSON());
  return job;
}

describe('CorrelationWorker — Erfolgspfad', () => {
  test('erfolgreicher Job: Resultat gespeichert, Job completed (ack)', async () => {
    const job = await seedJob();
    await worker.process(msg(job.id));

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('completed');
    expect(stored.resultReference).toBeTruthy();

    const result = await repo.findLatestResultByTicket('T-1');
    expect(result.result).toEqual({ merged: true });
    expect(result.engineVersion).toBeTruthy();          // Pflichtregel 5
    expect(result.inputHash).toBe(job.inputHash);
    expect(result.evidenceRefs[0]).toMatchObject({ ticketId: 'T-1', role: 'subject' });
  });

  test('Case lädt Child-Tickets bounded und referenziert sie', async () => {
    tickets.getById.mockResolvedValueOnce(makeTicket('C-1', 'rev1', 'case'));
    tickets.findChildren.mockResolvedValueOnce([makeTicket('K-1', 'rev1'), makeTicket('K-2', 'rev1')]);
    const job = await seedJob({ ticketId: 'C-1' });

    await worker.process(msg(job.id));

    expect(tickets.findChildren).toHaveBeenCalledWith('C-1', { limit: 200 }); // bounded
    const result = await repo.findLatestResultByTicket('C-1');
    expect(result.evidenceRefs.map((r) => r.ticketId)).toEqual(['C-1', 'K-1', 'K-2']);
  });
});

describe('CorrelationWorker — Fehler- & Sonderpfade', () => {
  test('Engine-Fehler → Retry-Pfad, KEIN Resultat, Fehler weitergeworfen', async () => {
    engine.correlate.mockImplementation(() => { throw new Error('engine boom'); });
    const job = await seedJob();

    await expect(worker.process(msg(job.id))).rejects.toThrow('engine boom');

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('retrying');
    expect(stored.retryCount).toBe(1);
    expect(await repo.findLatestResultByTicket('T-1')).toBeNull();
  });

  test('saveResult-Fehler → KEIN Ack (Job nicht completed), Fehler weitergeworfen', async () => {
    const job = await seedJob();
    jest.spyOn(repo, 'saveResult').mockRejectedValue(new Error('save boom'));

    await expect(worker.process(msg(job.id))).rejects.toThrow('save boom');

    const stored = await repo.findJobById(job.id);
    expect(stored.status).not.toBe('completed');
    expect(stored.resultReference).toBeNull();
  });

  // Verfeinert (2026-08-01): superseded verdrängt weiterhin NIE ein vorhandenes
  // Resultat (Monotonie — das ist die Zusicherung, auf die es ankommt). Neu ist
  // nur: hat das Ticket noch gar keines, wird das berechnete Resultat behalten,
  // statt es zu verwerfen — sonst hungern aktiv aggregierende Tickets dauerhaft
  // aus (siehe correlationSupersededStarvation.test.js).
  test('veraltete source_revision → vorhandenes Resultat bleibt unangetastet (superseded, ack)', async () => {
    const prior = new CorrelationResult({
      ticketId: 'T-1', jobId: 'older', inputHash: 'hash-neu', sourceRevision: 'rev2',
      engineVersion: 'v1', result: { merged: 'BESTAND' }, evidenceRefs: [],
    });
    await repo.saveResult(prior.toJSON());

    const job = await seedJob({ sourceRevision: 'rev1' });
    tickets.getRevision.mockResolvedValue('rev2'); // Ticket hat sich geändert

    await worker.process(msg(job.id)); // kein throw — kontrollierte Verwerfung

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('failed');
    expect(stored.failureReason).toMatch(/superseded/);
    expect((await repo.findLatestResultByTicket('T-1')).result).toEqual({ merged: 'BESTAND' });
  });

  // Fix Delete-Timeout: ein Job, dessen Ticket zwischenzeitlich GELÖSCHT wurde, darf
  // KEINEN Retry-Storm auslösen (weder App- noch pg-boss-Retry) — kontrolliert acken.
  test('Ticket zwischenzeitlich gelöscht → failed (ack), KEIN throw, KEIN Retry', async () => {
    const job = await seedJob();
    tickets.getById.mockResolvedValueOnce(null); // Ticket ist weg

    await expect(worker.process(msg(job.id))).resolves.toBeUndefined(); // kein throw

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('failed');           // nicht 'retrying'
    expect(stored.retryCount).toBe(0);              // kein Retry angestoßen
    expect(stored.failureReason).toMatch(/gelöscht|deleted|nicht mehr/i);
    expect(await repo.findLatestResultByTicket('T-1')).toBeNull();
  });

  test('gleicher Input: kein Doppelresultat (vorhandenes Result wird wiederverwendet)', async () => {
    const job = await seedJob();
    const pre = new CorrelationResult({
      ticketId: 'T-1', jobId: 'other', inputHash: job.inputHash, sourceRevision: 'rev1', result: { pre: true },
    });
    await repo.saveResult(pre.toJSON());

    await worker.process(msg(job.id));

    expect(engine.correlate).not.toHaveBeenCalled();      // kein Recompute
    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('completed');
    expect(stored.resultReference).toBe(pre.id);          // bestehendes Resultat verknüpft
  });

  test('fehlerhafte Nachricht / fehlender Job → ack ohne Crash', async () => {
    await expect(worker.process({ data: {} })).resolves.toBeUndefined();
    await expect(worker.process(msg('gibt-es-nicht'))).resolves.toBeUndefined();
  });

  test('bereits terminaler Job → idempotenter ack, kein Reprocess', async () => {
    const job = await seedJob();
    job.start(); job.complete('res-x');
    await repo.updateJob(job.toJSON());

    await worker.process(msg(job.id));
    expect(engine.correlate).not.toHaveBeenCalled();
  });
});

describe('CorrelationWorker — Lifecycle & Queue-Wiring', () => {
  test('start() registriert den Handler, stop() setzt running zurück', async () => {
    expect(worker.isRunning()).toBe(false);
    await worker.start();
    expect(queue.registerWorker).toHaveBeenCalledWith('correlation.process', expect.any(Function));
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  test('end-to-end über die (InMemory-)Queue: enqueue → Worker → completed', async () => {
    const q = new InMemoryQueueService();
    await q.start();
    const w = new CorrelationWorker({ repo, queue: q, engine, tickets, queueName: 'correlation.process' });
    await w.start();

    const job = await seedJob();
    await q.enqueue('correlation.process', { correlationJobId: job.id });

    const stored = await repo.findJobById(job.id);
    expect(stored.status).toBe('completed');
  });
});
