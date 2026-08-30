'use strict';

// P_CORR_ADMIN_2 Stufe 3 — der Worker meldet an Job-Grenzen + idle die übernommene
// Config-Version + Heartbeat. Ohne statusReporter bleibt das Verhalten unverändert.

const { CorrelationWorker } = require('../../src/correlation/CorrelationWorker');
const { RuntimeConfigProvider, CAP_MAX_CHILDREN } = require('../../src/applyChannel/RuntimeConfigProvider');
const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');
const { InMemoryWorkerStatusRepository } = require('../../src/applyChannel/InMemoryWorkerStatusRepository');
const { WorkerStatusReporter } = require('../../src/applyChannel/WorkerStatusReporter');

function fakeQueue() { return { registerWorker: async () => {} }; }

function build() {
  const applyRepo = new InMemoryApplyRepository();
  const statusRepo = new InMemoryWorkerStatusRepository();
  const provider = new RuntimeConfigProvider({ applyRepo });
  const reporter = new WorkerStatusReporter({ repo: statusRepo, workerId: 'corr-1' });
  const worker = new CorrelationWorker({
    repo: {}, queue: fakeQueue(), engine: { correlate() {} }, tickets: {},
    configProvider: provider, statusReporter: reporter,
  });
  return { applyRepo, statusRepo, worker };
}

test('_reportBoundary meldet aktive Version + Heartbeat + Queue-Zustand', async () => {
  const { applyRepo, statusRepo, worker } = build();
  const w = await applyRepo.writeRuntimeConfig({ capabilityId: CAP_MAX_CHILDREN, targetId: 'correlation-worker', value: { maxChildren: 333 }, appliedBy: 'a' });
  await worker._reportBoundary('processing');
  const st = await statusRepo.get('corr-1');
  expect(st.adoptedConfigVersions[CAP_MAX_CHILDREN]).toBe(w.version);
  expect(st.queueProcessingState).toBe('processing');
  expect(st.lastHeartbeatAt).toBeTruthy();
});

test('leerer Store → kein adoption-Eintrag, aber Heartbeat (idle lebt)', async () => {
  const { statusRepo, worker } = build();
  await worker._reportBoundary('idle');
  const st = await statusRepo.get('corr-1');
  expect(st.adoptedConfigVersions).toEqual({});
  expect(st.queueProcessingState).toBe('idle');
  expect(st.lastHeartbeatAt).toBeTruthy();
});

test('start() macht initialen idle-Report; stop() räumt den Timer', async () => {
  const { applyRepo, statusRepo, worker } = build();
  await applyRepo.writeRuntimeConfig({ capabilityId: CAP_MAX_CHILDREN, targetId: 'correlation-worker', value: { maxChildren: 200 }, appliedBy: 'a' });
  await worker.start();
  const st = await statusRepo.get('corr-1');
  expect(st.queueProcessingState).toBe('idle');
  expect(st.adoptedConfigVersions[CAP_MAX_CHILDREN]).toBe(1);
  await worker.stop();
});

test('ohne statusReporter wirft/meldet nichts (Verhalten unverändert)', async () => {
  const applyRepo = new InMemoryApplyRepository();
  const worker = new CorrelationWorker({ repo: {}, queue: fakeQueue(), engine: { correlate() {} }, tickets: {}, configProvider: new RuntimeConfigProvider({ applyRepo }) });
  await expect(worker._reportBoundary('processing')).resolves.toBeUndefined();
});
