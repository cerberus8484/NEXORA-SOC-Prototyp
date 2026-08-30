'use strict';

// P_CORR_1c.1 — Trigger/Scheduling: idempotenter persistenter Job, resiliente Queue-Benachrichtigung,
// Reconcile, Relevanz-Filter. InMemory-Repo + Stub-Queue (ohne echte DB/HTTP).

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { CorrelationSchedulingService, isRelevantTicketChange } = require('../../src/correlation/CorrelationSchedulingService');
const { computeInputHash } = require('../../src/correlation/correlationJobDomain');

let repo;
let queue;
let metrics;
let scheduler;

beforeEach(() => {
  repo = new InMemoryCorrelationRepository();
  queue = { enqueue: jest.fn(async () => 'qid') };
  metrics = { enqueueFailed: jest.fn() };
  scheduler = new CorrelationSchedulingService({ repo, queue, queueName: 'correlation.process', metrics });
});

describe('isRelevantTicketChange', () => {
  test('reine Workflow-Felder → irrelevant', () => {
    expect(isRelevantTicketChange(['analyst', 'status', 'notes'])).toBe(false);
    expect(isRelevantTicketChange([])).toBe(false);
  });
  test('engine-relevantes Feld → relevant', () => {
    expect(isRelevantTicketChange(['analyst', 'raw'])).toBe(true);
    expect(isRelevantTicketChange(['detection'])).toBe(true);
  });
});

describe('CorrelationSchedulingService', () => {
  test('relevante Änderung erzeugt genau EINEN idempotenten Job + Queue-Notify', async () => {
    const r = await scheduler.onTicketChanged({ id: 'T-1', updatedAt: 'rev1' }, ['raw']);
    expect(r.scheduled).toBe(true);
    expect(r.enqueued).toBe(true);

    const hash = computeInputHash({ ticketId: 'T-1', sourceRevision: 'rev1' });
    const active = await repo.findActiveJobByInputHash(hash);
    expect(active).toBeTruthy();
    expect(queue.enqueue).toHaveBeenCalledWith('correlation.process', { correlationJobId: active.id }, { singletonKey: hash });
  });

  test('gleicher Input erzeugt KEINEN Doppeljob', async () => {
    await scheduler.onTicketChanged({ id: 'T-1', updatedAt: 'rev1' }, ['raw']);
    await scheduler.onTicketChanged({ id: 'T-1', updatedAt: 'rev1' }, ['source']);

    const jobs = (await repo.findSchedulableJobs({})).filter((j) => j.ticketId === 'T-1');
    expect(jobs).toHaveLength(1);
  });

  test('irrelevante Ticket-Änderung erzeugt KEINEN Job', async () => {
    const r = await scheduler.onTicketChanged({ id: 'T-2', updatedAt: 'rev1' }, ['analyst', 'status']);
    expect(r.scheduled).toBe(false);
    expect(r.reason).toBe('irrelevant');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(await repo.findSchedulableJobs({})).toHaveLength(0);
  });

  test('Queue-Enqueue-Fehler verliert den persistenten Job NICHT (kein Fake-Erfolg)', async () => {
    queue.enqueue.mockRejectedValue(new Error('queue down'));
    const r = await scheduler.onTicketChanged({ id: 'T-3', updatedAt: 'rev1' }, ['raw']);

    expect(r.scheduled).toBe(true);
    expect(r.enqueued).toBe(false);            // ehrlich: nicht eingereiht
    expect(metrics.enqueueFailed).toHaveBeenCalled();

    const pending = (await repo.findSchedulableJobs({})).filter((j) => j.ticketId === 'T-3' && j.status === 'pending');
    expect(pending).toHaveLength(1);           // bleibt persistent pending
  });

  test('reconcile() reiht zuvor nicht eingereihte pending-Jobs erneut ein', async () => {
    queue.enqueue.mockRejectedValue(new Error('down'));
    await scheduler.onTicketChanged({ id: 'A', updatedAt: 'r' }, ['raw']);
    await scheduler.onTicketChanged({ id: 'B', updatedAt: 'r' }, ['raw']);

    queue.enqueue.mockResolvedValue('qid'); // Queue erholt sich
    const res = await scheduler.reconcile({});
    expect(res.total).toBe(2);
    expect(res.requeued).toBe(2);
  });

  test('onInputChanged (Evidence/Flow) reiht idempotent ein', async () => {
    const r = await scheduler.onInputChanged({ ticketId: 'T-9', sourceRevision: 'ev-1', reason: 'evidence' });
    expect(r.scheduled).toBe(true);
    expect(r.reason).toBe('evidence');
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  test('ohne ticketId/sourceRevision → kein Job', async () => {
    const r = await scheduler.schedule({ ticketId: '', sourceRevision: '' });
    expect(r.scheduled).toBe(false);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
