'use strict';

// P_CORR_ADMIN_2 Stufe 3 — echte Live-Health: fail-closed Probe + Polling-Adapter.
// Pflicht-Fälle: frisch+korrekt → gesund; kein/staler Heartbeat, falsche Version,
// Queue-Stall, Timeout → fail-closed; Übernahme während des Pollings → wird gesund.
// KEIN konservatives true ohne echte Probe.

const { buildWorkerProbe } = require('../../src/applyChannel/workerHealthProbe');
const { buildCorrelationHealthAdapter } = require('../../src/applyChannel/correlationHealthAdapter');
const { InMemoryWorkerStatusRepository } = require('../../src/applyChannel/InMemoryWorkerStatusRepository');
const { WorkerStatusReporter } = require('../../src/applyChannel/WorkerStatusReporter');
const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');

const CAP = 'correlator.worker.maxChildren';
const TARGET = 'correlation-worker';
const MAX_AGE = 5000;

function setup() {
  const t = { ms: 1_000_000 };
  const now = () => t.ms;
  const sleep = async (ms) => { t.ms += ms; };
  const statusRepo = new InMemoryWorkerStatusRepository();
  const applyRepo = new InMemoryApplyRepository();
  const reporter = new WorkerStatusReporter({ repo: statusRepo, workerId: 'corr-1', clock: now });
  const probe = buildWorkerProbe({ workerStatusRepo: statusRepo, workerId: 'corr-1', heartbeatMaxAgeMs: MAX_AGE, now });
  const adapter = buildCorrelationHealthAdapter({ applyRepo, workerProbe: probe, sleep, now, pollIntervalMs: 250 });
  return { t, now, statusRepo, applyRepo, reporter, adapter };
}

async function writeStore(applyRepo, value = { maxChildren: 300 }) {
  return applyRepo.writeRuntimeConfig({ capabilityId: CAP, targetId: TARGET, value, appliedBy: 'a' });
}

describe('Live-Health — gesund nur bei allen Signalen', () => {
  test('Store-Version aktiv + Worker übernommen + frisch + queue idle → healthy', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.adopt(CAP, w.version, 'idle');
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 2000 });
    expect(res.healthy).toBe(true);
    expect(res.adoptedOk && res.heartbeatFresh && res.queueOk).toBe(true);
  });

  test('queue processing zählt auch als gesund', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.adopt(CAP, w.version, 'processing');
    expect((await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 2000 })).healthy).toBe(true);
  });
});

describe('Live-Health — fail-closed', () => {
  test('kein Heartbeat/Status → unhealthy (kein konservatives true)', async () => {
    const { applyRepo, adapter } = setup();
    const w = await writeStore(applyRepo);
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 1000 });
    expect(res.healthy).toBe(false);
    expect(res.heartbeatFresh).toBe(false);
  });

  test('staler Heartbeat → unhealthy', async () => {
    const { t, applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.adopt(CAP, w.version, 'idle');
    t.ms += MAX_AGE + 1; // Heartbeat veraltet jetzt
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 1000 });
    expect(res.healthy).toBe(false);
    expect(res.heartbeatFresh).toBe(false);
  });

  test('falsche übernommene Version → unhealthy', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo); // version 1
    await reporter.adopt(CAP, w.version - 1 || 0, 'idle'); // Worker auf alter Version
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 1000 });
    expect(res.healthy).toBe(false);
    expect(res.adoptedOk).toBe(false);
  });

  test('Queue-Stall → unhealthy', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.adopt(CAP, w.version, 'stalled');
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 1000 });
    expect(res.healthy).toBe(false);
    expect(res.queueOk).toBe(false);
  });

  test('Store-Version nicht aktiv (Mismatch) → unhealthy', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.adopt(CAP, w.version + 1, 'idle');
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version + 1, timeoutMs: 1000 });
    expect(res.healthy).toBe(false); // store hat nur version w.version aktiv
  });

  test('Timeout: Worker übernimmt nie → unhealthy mit Grund', async () => {
    const { applyRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.heartbeat('idle'); // lebt, aber adoptiert nie die neue Version
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 1000 });
    expect(res.healthy).toBe(false);
    expect(res.reason).toBeTruthy();
  });
});

describe('Live-Health — Übernahme während des Pollings', () => {
  test('Worker adoptiert die Version während der Health-Phase → wird gesund', async () => {
    const { t, now, applyRepo, statusRepo, reporter, adapter } = setup();
    const w = await writeStore(applyRepo);
    await reporter.heartbeat('idle'); // lebt, noch nicht adoptiert
    // Sleep-Hook simuliert den Worker, der an der nächsten Job-Grenze/idle-Tick übernimmt.
    let ticks = 0;
    const sleep = async (ms) => { t.ms += ms; if (++ticks === 1) await new WorkerStatusReporter({ repo: statusRepo, workerId: 'corr-1', clock: now }).adopt(CAP, w.version, 'idle'); };
    const adapter2 = buildCorrelationHealthAdapter({ applyRepo, workerProbe: buildWorkerProbe({ workerStatusRepo: statusRepo, workerId: 'corr-1', heartbeatMaxAgeMs: MAX_AGE, now }), sleep, now, pollIntervalMs: 250 });
    const res = await adapter2.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 5000 });
    expect(res.healthy).toBe(true);
    expect(reporter).toBeTruthy();
  });
});

describe('Live-Health — ohne Probe ist nichts gesund', () => {
  test('Adapter ohne workerProbe → fail-closed unhealthy', async () => {
    const applyRepo = new InMemoryApplyRepository();
    const w = await writeStore(applyRepo);
    const adapter = buildCorrelationHealthAdapter({ applyRepo, workerProbe: null, sleep: async () => {}, now: () => 0, pollIntervalMs: 1 });
    const res = await adapter.checkHealth({ capabilityId: CAP, targetId: TARGET, expectedVersion: w.version, timeoutMs: 0 });
    expect(res.healthy).toBe(false);
  });
});
