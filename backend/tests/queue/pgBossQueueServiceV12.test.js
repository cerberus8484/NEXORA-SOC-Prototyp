'use strict';

// P_CORR_0 — PgBossQueueService gegen die pg-boss-v12-API verifizieren OHNE echte DB
// (gemockte pg-boss-Instanz injiziert). Live-Verhalten (Retry/Backoff/Dead-Letter/Recovery)
// deckt die separate, geguardete Integrationssuite gegen ein wegwerfbares Postgres ab.

const { PgBossQueueService } = require('../../src/queue/PgBossQueueService');

// Minimaler pg-boss-v12-Mock: erfasst Aufrufe + lässt den work-Handler gezielt auslösen.
function makeMockBoss({ existingQueues = [] } = {}) {
  const queues = new Map(existingQueues.map((n) => [n, { name: n }]));
  const calls = { createQueue: [], send: [], work: [], stop: [], started: 0 };
  let workHandler = null;
  return {
    calls,
    on() {},
    async start() { calls.started += 1; return this; },
    async stop(opts) { calls.stop.push(opts); },
    async getQueue(name) { return queues.get(name) ?? null; },
    async createQueue(name, opts) { calls.createQueue.push({ name, opts }); queues.set(name, { name }); },
    async send(name, data, opts) { calls.send.push({ name, data, opts }); return `job-${calls.send.length}`; },
    async work(name, opts, handler) { calls.work.push({ name, opts }); workHandler = handler; return 'worker-1'; },
    async getQueueStats(name) { calls.getQueueStats = name; return { queuedCount: 2, activeCount: 1 }; },
    // Test-Helfer: simuliert pg-boss, das den Handler mit einem Jobs-ARRAY aufruft (v12).
    invoke(jobs) { return workHandler(jobs); },
  };
}

let boss;
let q;
beforeEach(() => {
  boss = makeMockBoss();
  q = new PgBossQueueService({ boss });
});

describe('PgBossQueueService — pg-boss v12 (P_CORR_0)', () => {
  test('enqueue legt Queue + Dead-Letter-Queue an und sendet mit v12-Optionen', async () => {
    const id = await q.enqueue('corr.process', { x: 1 }, { singletonKey: 'k1' });
    expect(id).toBe('job-1');

    const created = boss.calls.createQueue.map((c) => c.name);
    expect(created).toContain('corr.process');
    expect(created).toContain('corr.process.dlq');

    const main = boss.calls.createQueue.find((c) => c.name === 'corr.process');
    expect(main.opts.deadLetter).toBe('corr.process.dlq');
    expect(main.opts.retryLimit).toBe(3);
    expect(main.opts.retryBackoff).toBe(true);

    const sent = boss.calls.send[0];
    expect(sent.opts).not.toHaveProperty('expireInHours'); // v12 kennt nur expireInSeconds
    expect(sent.opts.expireInSeconds).toBeUndefined();     // kein Default → pg-boss-Default (Active-Timeout)
    expect(sent.opts.singletonKey).toBe('k1');             // Idempotenz-Schlüssel durchgereicht
    expect(sent.opts.retryLimit).toBe(3);
  });

  test('expireInSeconds wird nur durchgereicht, wenn explizit gesetzt (Max 24h-Falle vermeiden)', async () => {
    await q.enqueue('corr.exp', {}, { expireInSeconds: 300 });
    expect(boss.calls.send[0].opts.expireInSeconds).toBe(300);
  });

  test('Queue wird nur EINMAL angelegt (idempotent über mehrere enqueue)', async () => {
    await q.enqueue('corr.process', { x: 1 });
    await q.enqueue('corr.process', { x: 2 });
    expect(boss.calls.createQueue.filter((c) => c.name === 'corr.process')).toHaveLength(1);
    expect(boss.calls.send).toHaveLength(2);
  });

  test('createQueue wird übersprungen, wenn die Queue bereits existiert', async () => {
    boss = makeMockBoss({ existingQueues: ['corr.process', 'corr.process.dlq'] });
    q = new PgBossQueueService({ boss });
    await q.enqueue('corr.process', {});
    expect(boss.calls.createQueue).toHaveLength(0);
  });

  test('registerWorker nutzt batchSize:1 + includeMetadata und normalisiert das Job-Array', async () => {
    const seen = [];
    await q.registerWorker('corr.process', async (job) => { seen.push(job.id); });
    expect(boss.calls.work[0].opts).toEqual({ batchSize: 1, includeMetadata: true });

    await boss.invoke([{ id: 'j1', data: { a: 1 }, retryCount: 0 }]); // v12: Array
    expect(seen).toEqual(['j1']);
    expect((await q.stats()).completed).toBe(1);
  });

  test('Handler-Fehler wird WEITERGEWORFEN (kein stiller Erfolg) und als failed gezählt', async () => {
    await q.registerWorker('corr.fail', async () => { throw new Error('boom'); });
    await expect(boss.invoke([{ id: 'j2', data: {}, retryCount: 0 }])).rejects.toThrow('boom');
    expect((await q.stats()).failed).toBe(1);
    expect((await q.stats()).completed).toBe(0);
  });

  test('retryCount > 0 wird als retried gezählt', async () => {
    await q.registerWorker('corr.process', async () => {});
    await boss.invoke([{ id: 'j3', data: {}, retryCount: 2 }]);
    expect((await q.stats()).retried).toBe(1);
  });

  test('policy wird an createQueue durchgereicht (Idempotenz-Grundlage für P_CORR_1a)', async () => {
    await q.enqueue('corr.idem', { x: 1 }, { policy: 'stately', singletonKey: 'k1' });
    const main = boss.calls.createQueue.find((c) => c.name === 'corr.idem');
    expect(main.opts.policy).toBe('stately');
    expect(boss.calls.send[0].opts.singletonKey).toBe('k1');
  });

  test('stats liefert depth/running live aus getQueueStats + Prozess-Zähler', async () => {
    await q.enqueue('corr.process', {}); // registriert die Queue für stats()
    const s = await q.stats();
    expect(s.depth).toBe(2);    // queuedCount
    expect(s.running).toBe(1);  // activeCount
    expect(s.enqueued).toBe(1);
    expect(s.oldestQueuedAgeMs).toBe(0); // ehrlich 0 (offizielle API liefert es nicht billig)
  });

  test('stop beendet graceful', async () => {
    await q.start();
    await q.stop();
    expect(boss.calls.started).toBe(1);
    expect(boss.calls.stop[0]).toMatchObject({ graceful: true });
  });
});

// Fix Delete-Timeout: pg-boss öffnet einen EIGENEN DB-Pool zusätzlich zum App-Pool.
// Ohne `max` nimmt es den Default (~10) → zwei Pools/Prozess können die soc_api-
// Verbindungen erschöpfen (Symptom: System-Timeout nach wenigen schnellen Deletes).
describe('buildPgBossConfig — gecappter Pool (Anti-Exhaustion)', () => {
  const { buildPgBossConfig } = require('../../src/queue/PgBossQueueService');

  test('Default-Pool ist gecappt (nicht der pg-boss-Default ~10) + benannt', () => {
    const cfg = buildPgBossConfig({});
    expect(cfg.max).toBe(4);
    expect(cfg.application_name).toBe('nexora-pgboss');
    expect(cfg.max).toBeLessThan(10);
  });

  test('PGBOSS_POOL_MAX übersteuert den Cap (Integer)', () => {
    const cfg = buildPgBossConfig({ PGBOSS_POOL_MAX: '6', DB_HOST: 'db', DB_NAME: 'x', DB_USER: 'u' });
    expect(cfg.max).toBe(6);
    expect(cfg).toMatchObject({ host: 'db', database: 'x', user: 'u' });
  });
});
