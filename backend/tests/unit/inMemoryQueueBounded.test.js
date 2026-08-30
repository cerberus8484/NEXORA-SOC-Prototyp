'use strict';

const { InMemoryQueueService } = require('../../src/queue/InMemoryQueueService');

describe('InMemoryQueueService — bounded + stats (P_STABILITY_2)', () => {
  it('hält nur die letzten maxRetained Jobs (kein unbounded RAM)', async () => {
    const q = new InMemoryQueueService({ maxRetained: 3 });
    for (let i = 0; i < 10; i++) await q.enqueue('q', { i }); // ohne Worker → 'queued'
    expect(q.getJobs().length).toBe(3);
  });

  it('monotone Zähler überleben das Bounding', async () => {
    const q = new InMemoryQueueService({ maxRetained: 2 });
    await q.registerWorker('q', async () => {});
    await q.start();
    for (let i = 0; i < 5; i++) await q.enqueue('q', { i });

    const s = await q.stats();
    expect(s.enqueued).toBe(5);
    expect(s.completed).toBe(5);
    expect(s.retained).toBe(2);     // Ring gekappt
    expect(s.maxRetained).toBe(2);
  });

  it('stats(): depth zählt wartende Jobs', async () => {
    const q = new InMemoryQueueService();
    await q.enqueue('q', {});
    await q.enqueue('q', {});
    const s = await q.stats();
    expect(s.depth).toBe(2);
    expect(s.running).toBe(0);
  });

  it('stats(): failed zählt fehlgeschlagene Jobs (Zähler, nicht aus dem Ring)', async () => {
    const q = new InMemoryQueueService();
    await q.registerWorker('q', async () => { throw new Error('x'); });
    await q.start();
    await q.enqueue('q', {});
    const s = await q.stats();
    expect(s.failed).toBe(1);
    expect(s.completed).toBe(0);
  });

  it('oldestQueuedAgeMs ist 0 ohne wartende Jobs', async () => {
    const q = new InMemoryQueueService();
    await q.registerWorker('q', async () => {});
    await q.start();
    await q.enqueue('q', {}); // sofort completed
    const s = await q.stats();
    expect(s.depth).toBe(0);
    expect(s.oldestQueuedAgeMs).toBe(0);
  });

  it('Default-Konstruktor bleibt rückwärtskompatibel (kein Arg)', async () => {
    const q = new InMemoryQueueService();
    const id = await q.enqueue('q', { a: 1 });
    expect(id).toBeDefined();
    expect(q.getJobs('q').length).toBe(1);
  });
});
