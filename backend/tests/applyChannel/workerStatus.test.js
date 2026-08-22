'use strict';

// P_CORR_ADMIN_2 Stufe 3 — Worker-Status-Repo + Reporter (persistente Live-Signale).

const { InMemoryWorkerStatusRepository } = require('../../src/applyChannel/InMemoryWorkerStatusRepository');
const { WorkerStatusReporter } = require('../../src/applyChannel/WorkerStatusReporter');

let repo;
beforeEach(() => { repo = new InMemoryWorkerStatusRepository(); });

describe('Repo — upsert/merge', () => {
  test('get unbekannt → null', async () => {
    expect(await repo.get('w1')).toBeNull();
  });
  test('upsert legt an + merged adoptedConfigVersions (Map)', async () => {
    await repo.upsert('w1', { lastHeartbeatAt: 't1', adoptedConfigVersions: { 'correlator.worker.maxChildren': 1 }, queueProcessingState: 'idle' });
    await repo.upsert('w1', { adoptedConfigVersions: { 'correlator.worker.maxRetries': 2 } });
    const st = await repo.get('w1');
    expect(st.adoptedConfigVersions).toEqual({ 'correlator.worker.maxChildren': 1, 'correlator.worker.maxRetries': 2 });
    expect(st.queueProcessingState).toBe('idle'); // bleibt erhalten
  });
});

describe('Reporter — semantische Meldungen', () => {
  let now; let reporter;
  beforeEach(() => {
    now = 1_000_000;
    reporter = new WorkerStatusReporter({ repo, workerId: 'corr-1', clock: () => now });
  });

  test('heartbeat setzt lastHeartbeatAt + Queue-Zustand', async () => {
    await reporter.heartbeat('idle');
    const st = await repo.get('corr-1');
    expect(new Date(st.lastHeartbeatAt).getTime()).toBe(now);
    expect(st.queueProcessingState).toBe('idle');
  });

  test('adopt meldet übernommene Version je Capability + frischen Heartbeat', async () => {
    await reporter.adopt('correlator.worker.maxChildren', 5);
    const st = await repo.get('corr-1');
    expect(st.adoptedConfigVersions['correlator.worker.maxChildren']).toBe(5);
    expect(new Date(st.lastHeartbeatAt).getTime()).toBe(now);
  });

  test('jobStarted → processing, jobCompleted → idle + outcome', async () => {
    await reporter.jobStarted();
    expect((await repo.get('corr-1')).queueProcessingState).toBe('processing');
    now += 5;
    await reporter.jobCompleted('completed');
    const st = await repo.get('corr-1');
    expect(st.queueProcessingState).toBe('idle');
    expect(st.lastJobOutcome).toBe('completed');
    expect(new Date(st.lastJobCompletedAt).getTime()).toBe(now);
  });
});
