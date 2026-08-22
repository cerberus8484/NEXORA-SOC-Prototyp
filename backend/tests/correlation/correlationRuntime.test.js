'use strict';

// P_CORR_1c.1a — Composition Root: Scheduler UND Worker teilen DIESELBE Queue/Repo-Instanz,
// kein stiller InMemory-Fallback bei Queue-Start-Fehler, end-to-end über eine Queue.

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { InMemoryQueueService } = require('../../src/queue/InMemoryQueueService');
const { buildCorrelationRuntime } = require('../../src/correlation/correlationRuntime');
const { CorrelationJob } = require('../../src/correlation/correlationJobDomain');

const makeTickets = () => ({
  getById:      jest.fn(async (id) => ({ id, kind: 'alert', updatedAt: 'rev1', raw: `evt-${id}` })),
  findChildren: jest.fn(async () => []),
  getRevision:  jest.fn(async () => 'rev1'),
});

describe('correlationRuntime — geteilte Instanzen', () => {
  test('Scheduler und Worker erhalten DIESELBE Queue- und Repo-Instanz', () => {
    const queue = new InMemoryQueueService();
    const repo  = new InMemoryCorrelationRepository();
    const rt = buildCorrelationRuntime({ queue, repo, engine: { correlate: () => ({}) }, tickets: makeTickets() });

    expect(rt.scheduler._queue).toBe(queue);
    expect(rt.worker._queue).toBe(queue);
    expect(rt.scheduler._queue).toBe(rt.worker._queue);
    expect(rt.scheduler._repo).toBe(repo);
    expect(rt.worker._repo).toBe(repo);
    expect(rt.queue).toBe(queue);
  });
});

describe('correlationRuntime — kein stiller Fallback', () => {
  test('Queue-Start-Fehler lässt runtime.start() SICHTBAR scheitern (kein InMemory-Fallback)', async () => {
    const failingQueue = {
      start:          jest.fn(async () => { throw new Error('pg-boss unavailable'); }),
      registerWorker: jest.fn(async () => {}),
      enqueue:        jest.fn(async () => {}),
      stats:          jest.fn(async () => ({})),
    };
    const rt = buildCorrelationRuntime({
      queue: failingQueue, repo: new InMemoryCorrelationRepository(),
      engine: { correlate: () => ({}) }, tickets: makeTickets(),
    });

    await expect(rt.start()).rejects.toThrow('pg-boss unavailable');
    expect(rt.isStarted()).toBe(false);
    expect(failingQueue.registerWorker).not.toHaveBeenCalled(); // Worker nie aktiviert
  });
});

describe('correlationRuntime — end-to-end über EINE Queue', () => {
  test('Mutation → Scheduler → persistenter Job → über DIESELBE Queue an den Worker → Resultat', async () => {
    const queue  = new InMemoryQueueService();
    const repo   = new InMemoryCorrelationRepository();
    const engine = { correlate: jest.fn(() => ({ merged: true })) };
    const rt = buildCorrelationRuntime({ queue, repo, engine, tickets: makeTickets() });
    await rt.start();

    const res = await rt.scheduler.onInputChanged({ ticketId: 'T-1', sourceRevision: 'rev1', reason: 'evidence' });
    expect(res.scheduled).toBe(true);
    expect(res.enqueued).toBe(true);

    // InMemory-Queue verarbeitet synchron → der Worker hat den Job über dieselbe Queue erhalten.
    const result = await repo.findLatestResultByTicket('T-1');
    expect(result).toBeTruthy();
    expect(result.result).toEqual({ merged: true });
    expect((await repo.findJobById(res.jobId)).status).toBe('completed');
  });

  test('reconcile() reiht einen pending-Job über die RUNTIME-Queue erneut ein → verarbeitet', async () => {
    const queue  = new InMemoryQueueService();
    const repo   = new InMemoryCorrelationRepository();
    const engine = { correlate: jest.fn(() => ({ ok: true })) };
    const rt = buildCorrelationRuntime({ queue, repo, engine, tickets: makeTickets() });

    // pending-Job anlegen, BEVOR der Worker läuft (also noch nicht eingereiht/verarbeitet).
    const job = CorrelationJob.create({ ticketId: 'T-1', sourceRevision: 'rev1' });
    await repo.createJob(job.toJSON());

    await rt.start();
    const r = await rt.reconcile({});
    expect(r.requeued).toBe(1);
    expect((await repo.findJobById(job.id)).status).toBe('completed');
  });
});
