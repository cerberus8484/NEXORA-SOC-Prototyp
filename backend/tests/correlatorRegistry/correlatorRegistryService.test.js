'use strict';

// P_CORR_ADMIN_1 — CorrelatorRegistryService: komponiert Catalog + Correlation-Repo
// + ConfigRegistryService. Read-only Registry-Sicht; unknown=deny; keine Rohpayloads.

const { CorrelatorRegistryService } = require('../../src/correlatorRegistry/correlatorRegistryService');
const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { InMemoryConfigRepository } = require('../../src/configRegistry/InMemoryConfigRepository');
const { ConfigRegistryService } = require('../../src/configRegistry/ConfigRegistryService');
const { CorrelationJob, CorrelationResult } = require('../../src/correlation/correlationJobDomain');
const { REAL_CORRELATOR_ID } = require('../../src/correlatorRegistry/correlatorRegistryCatalog');

const ENGINEER = { role: 'engineer', label: 'eng@nexora' };

function build() {
  const correlationRepo = new InMemoryCorrelationRepository();
  const configService = new ConfigRegistryService({ repo: new InMemoryConfigRepository() });
  const svc = new CorrelatorRegistryService({ correlationRepo, configService });
  return { svc, correlationRepo, configService };
}

async function seedJobs(repo) {
  for (let i = 0; i < 2; i++) {
    const j = CorrelationJob.create({ ticketId: `INC-${i}`, sourceRevision: `r-${i}` });
    await repo.createJob(j.toJSON());
  }
  const done = CorrelationJob.create({ ticketId: 'INC-done', sourceRevision: 'r-d' });
  await repo.createJob(done.toJSON()); done.start(); done.complete('R-done');
  await repo.updateJob(done.toJSON());
  const sup = CorrelationJob.create({ ticketId: 'INC-sup', sourceRevision: 'r-s' });
  await repo.createJob(sup.toJSON()); sup.start(); sup.fail('superseded: r-s → r-new');
  await repo.updateJob(sup.toJSON());
}

describe('CorrelatorRegistryService — Registry + unknown=deny', () => {
  test('listCorrelators liefert den realen Correlator mit Queue-Summary', async () => {
    const { svc, correlationRepo } = build();
    await seedJobs(correlationRepo);
    const list = await svc.listCorrelators();
    const worker = list.find((c) => c.id === REAL_CORRELATOR_ID);
    expect(worker).toBeTruthy();
    expect(worker.queue.completed).toBe(1);
    expect(worker.queue.superseded).toBe(1);
    expect(worker.queue.failed).toBe(0); // superseded ist kein echter Fehler
    expect(worker.queue.active).toBe(2); // 2 pending
  });

  test('getCorrelator(unknown) → 404', async () => {
    const { svc } = build();
    await expect(svc.getCorrelator('nope')).rejects.toMatchObject({ status: 404 });
  });

  test('getCorrelator liefert lastActivityAt', async () => {
    const { svc, correlationRepo } = build();
    await seedJobs(correlationRepo);
    const c = await svc.getCorrelator(REAL_CORRELATOR_ID);
    expect(c.lastActivityAt).toBeTruthy();
  });
});

describe('CorrelatorRegistryService — Jobs/Results (sichere Summaries)', () => {
  test('listJobs liefert Summaries inkl. superseded-Markierung, kein Rohfehler', async () => {
    const { svc, correlationRepo } = build();
    await seedJobs(correlationRepo);
    const { data } = await svc.listJobs(REAL_CORRELATOR_ID, { limit: 50 });
    const sup = data.find((j) => j.superseded);
    expect(sup.presentationStatus).toBe('superseded');
    expect(sup.failureSummary).toBeNull();
    expect(data[0]).not.toHaveProperty('failureReason');
  });

  test('listResults gibt nur Meta aus, kein rohes Payload', async () => {
    const { svc, correlationRepo } = build();
    const r = new CorrelationResult({
      ticketId: 'INC-1', inputHash: 'h', sourceRevision: 'r', result: { payload: { secret: 'leak-me' }, correlation: { eventCount: 1, sources: [] } },
    });
    await correlationRepo.saveResult(r.toJSON());
    const { data } = await svc.listResults(REAL_CORRELATOR_ID, { limit: 10 });
    expect(JSON.stringify(data)).not.toContain('leak-me');
    expect(data[0]).toHaveProperty('eventCount');
  });

  test('listJobs(unknown) → 404', async () => {
    const { svc } = build();
    await expect(svc.listJobs('nope', {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('CorrelatorRegistryService — Config-Sicht', () => {
  test('getConfig listet die gebundenen Capabilities (applyStatus not_supported)', async () => {
    const { svc } = build();
    const cfg = await svc.getConfig(REAL_CORRELATOR_ID);
    const ids = cfg.bound.map((b) => b.id);
    expect(ids).toContain('correlator.worker.maxChildren');
    expect(ids).toContain('correlator.worker.maxRetries');
    expect(cfg.bound.every((b) => b.applyStatus === 'not_supported')).toBe(true);
  });

  test('getConfig zeigt reservierte/nicht-editierbare Capabilities sichtbar, aber gesperrt', async () => {
    const { svc } = build();
    const cfg = await svc.getConfig(REAL_CORRELATOR_ID);
    expect(cfg.reserved.every((r) => r.editable === false)).toBe(true);
    expect(cfg.reserved.find((r) => r.id === 'host.network.allowlist')).toBeTruthy();
  });

  test('getConfig hängt vorhandene Drafts an die gebundene Capability', async () => {
    const { svc, configService } = build();
    await configService.createDraft({ capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 42 }, actor: ENGINEER });
    const cfg = await svc.getConfig(REAL_CORRELATOR_ID);
    const cap = cfg.bound.find((b) => b.id === 'correlator.worker.maxChildren');
    expect(cap.drafts.length).toBe(1);
    expect(cap.drafts[0].value.maxChildren).toBe(42);
  });
});

describe('CorrelatorRegistryService — Audit', () => {
  test('listAudit liefert die Config-Audit-Spur der gebundenen Capabilities', async () => {
    const { svc, configService } = build();
    await configService.createDraft({ capabilityId: 'correlator.worker.maxRetries', targetId: 'correlation-worker', value: { maxRetries: 5 }, actor: ENGINEER });
    const { data } = await svc.listAudit(REAL_CORRELATOR_ID, { limit: 50 });
    expect(data.some((a) => a.type === 'config.draft.created')).toBe(true);
    expect(data.every((a) => a.capabilityId.startsWith('correlator.worker.'))).toBe(true);
  });
});
