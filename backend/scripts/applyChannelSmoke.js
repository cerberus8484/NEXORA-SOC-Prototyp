'use strict';

/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 — End-to-End Apply-Smoke-Test gegen ECHTES Postgres.
//
// Beweist die komplette Apply-Kette deterministisch + reproduzierbar:
//   1. Erfolgsweg  → applied         (REALER Worker übernimmt Config + meldet Heartbeat)
//   2. Fehlerweg   → rolled_back      (Apply-Health fail-closed, Rollback auf Baseline ok)
//   3. Safe-Stop   → failed_safe_stop (Rollback scheitert → globaler Safety-Lock, weitere Applies blockiert)
//
// CONFIG_APPLY_ENABLED wird AUSSCHLIESSLICH in DIESEM Prozess auf true gesetzt (env des
// Node-Prozesses, verschwindet beim Exit) — außerhalb bleibt der Flag unberührt.
//
// Scope strikt: nur correlator.worker.maxChildren/maxRetries. Kein OS/Shell/SSH/Restart/Netz.
// ─────────────────────────────────────────────────────────────────────────

// ── Env NUR für diesen isolierten Prozess (vor jedem require von config). ──
process.env.DB_ENABLED = 'true';
process.env.CONFIG_APPLY_ENABLED = 'true';            // nur in diesem ephemeren Prozess
process.env.CONFIG_APPLY_HEALTH_TIMEOUT_MS = process.env.CONFIG_APPLY_HEALTH_TIMEOUT_MS || '4000';
process.env.CONFIG_APPLY_HEARTBEAT_MAX_AGE_MS = process.env.CONFIG_APPLY_HEARTBEAT_MAX_AGE_MS || '10000';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5544';
process.env.DB_NAME = process.env.DB_NAME || 'soc_apply_smoke';
process.env.DB_USER = process.env.DB_USER || 'soc_smoke';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'smokepassword';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-only-secret-not-for-prod';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { migrate, pool } = require('../src/db/pool');
const { authService } = require('../src/services/AuthService');
const { ConfigRegistryService } = require('../src/configRegistry/ConfigRegistryService');
const { getConfigRepository } = require('../src/configRegistry/configRepositoryFactory');
const { getApplyRepository } = require('../src/applyChannel/applyRepositoryFactory');
const { getWorkerStatusRepository } = require('../src/applyChannel/workerStatusRepositoryFactory');
const { createCorrelatorApplyService } = require('../src/applyChannel/correlatorApplyServiceFactory');
const { RuntimeConfigProvider, CAP_MAX_CHILDREN } = require('../src/applyChannel/RuntimeConfigProvider');
const { WorkerStatusReporter } = require('../src/applyChannel/WorkerStatusReporter');
const { CorrelationWorker } = require('../src/correlation/CorrelationWorker');

const CORRELATOR = 'correlation-worker';
const CAP = CAP_MAX_CHILDREN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓ PASS' : '  ✗ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ── Helfer: genehmigter, eingefrorener Apply-Plan (echtes Postgres) ─────────
async function makeFrozenPlan(cfg, applySvc, ctx, value) {
  const draft = await cfg.createDraft({ capabilityId: CAP, targetId: CORRELATOR, value, actor: ctx.engineer });
  const sub = await cfg.submitForApproval({ draftId: draft.id, expectedVersion: draft.version, actor: ctx.engineer });
  await cfg.decide({ draftId: draft.id, decision: 'approved', expectedVersion: sub.version, note: 'smoke', actor: ctx.admin });
  return applySvc.freezePlan(CORRELATOR, draft.id, ctx.admin);
}
async function reauthToken(adminEmail) {
  return (await authService.issueApplyReauth({ email: adminEmail, password: 'Smoke1234!' })).token;
}
async function applyPlan(applySvc, planId, ctx) {
  return applySvc.apply(CORRELATOR, planId, { actor: ctx.adminActor, reauthToken: await reauthToken(ctx.admin.label) });
}

async function activeVersion(applyRepo) {
  const a = await applyRepo.getActiveRuntimeConfig(CAP, CORRELATOR);
  return a ? a.version : 0;
}

async function main() {
  console.log('\n=== P_CORR_ADMIN_2 Apply-Smoke (echtes Postgres) ===\n');
  await migrate();

  const applyRepo = getApplyRepository();
  const statusRepo = getWorkerStatusRepository();
  const cfg = new ConfigRegistryService({ repo: getConfigRepository() });
  const applySvc = createCorrelatorApplyService();

  // Nutzer: Ersteller ≠ Genehmiger für das Vier-Augen-Gate (label-basiert). Beide admin,
  // weil das Postgres-Schema (users_role_check) nur admin/analyst/viewer kennt — die
  // Vier-Augen-Trennung läuft über die Identität (createdBy ≠ approver), nicht die Rolle.
  const stamp = Date.now();
  const creatorEmail = `smoke-creator-${stamp}@x.io`;
  const admEmail = `smoke-approver-${stamp}@x.io`;
  await authService.register({ email: creatorEmail, password: 'Smoke1234!', displayName: 'creator', role: 'admin' });
  const admin = await authService.register({ email: admEmail, password: 'Smoke1234!', displayName: 'approver', role: 'admin' });
  const ctx = {
    engineer: { role: 'admin', label: creatorEmail }, // Draft-Ersteller
    admin: { role: 'admin', label: admEmail },         // Genehmiger
    adminActor: { id: admin.id, label: admEmail, role: 'admin' },
  };

  // Sicherheits-Lock zu Beginn defensiv lösen (idempotent in der frischen DB).
  await applyRepo.setSafetyLock(false, '');

  // ── 1) ERFOLGSWEG — realer, laufender Worker übernimmt die Config ──────────
  console.log('1) Erfolgsweg (realer Worker, applied):');
  const worker = new CorrelationWorker({
    repo: {}, queue: { registerWorker: async () => {} }, engine: { correlate() {} }, tickets: {},
    configProvider: new RuntimeConfigProvider({ applyRepo }),
    statusReporter: new WorkerStatusReporter({ repo: statusRepo, workerId: CORRELATOR }),
    heartbeatIntervalMs: 1000,
  });
  await worker.start(); // idle-Tick: übernimmt fortlaufend die aktive Version + Heartbeat
  try {
    const plan = await makeFrozenPlan(cfg, applySvc, ctx, { maxChildren: 251 });
    const run = await applyPlan(applySvc, plan.id, ctx);
    check('Apply-Run = applied', run.status === 'applied', `status=${run.status}`);
    const wh = await applySvc.getWorkerHealth(CORRELATOR);
    check('Worker meldet frischen Heartbeat + übernommene Version', wh.heartbeatFresh && wh.adoptedConfigVersions[CAP] >= 1,
      `heartbeatFresh=${wh.heartbeatFresh} adopted=${wh.adoptedConfigVersions[CAP]}`);
    const active = await applyRepo.getActiveRuntimeConfig(CAP, CORRELATOR);
    check('runtime_config trägt den angewendeten Wert', active && active.value.maxChildren === 251, `value=${JSON.stringify(active && active.value)}`);
  } finally {
    await worker.stop();
  }

  // ── 2) FEHLERWEG — Apply-Health fail-closed, Rollback auf Baseline → rolled_back ──
  console.log('\n2) Fehlerweg (Health fail-closed → rolled_back):');
  {
    const baseline = await activeVersion(applyRepo); // Worker „hängt" auf dieser Version
    await new WorkerStatusReporter({ repo: statusRepo, workerId: CORRELATOR }).adopt(CAP, baseline, 'idle');
    // Confirmer: bestätigt NUR die Rollback-Version (>= baseline+2), NICHT die Apply-Version (baseline+1).
    const reporter = new WorkerStatusReporter({ repo: statusRepo, workerId: CORRELATOR });
    const confirmer = setInterval(async () => {
      try { const v = await activeVersion(applyRepo); if (v >= baseline + 2) await reporter.adopt(CAP, v, 'idle'); } catch { /* ignore */ }
    }, 100);
    try {
      const plan = await makeFrozenPlan(cfg, applySvc, ctx, { maxChildren: 252 });
      const run = await applyPlan(applySvc, plan.id, ctx);
      check('Apply-Run = rolled_back', run.status === 'rolled_back', `status=${run.status}`);
      const active = await applyRepo.getActiveRuntimeConfig(CAP, CORRELATOR);
      check('runtime_config zeigt wieder die Baseline (251)', active && active.value.maxChildren === 251, `value=${JSON.stringify(active && active.value)}`);
      check('Safety-Lock NICHT gesetzt (kontrollierter Rollback)', (await applyRepo.getSafetyLock()).locked === false);
    } finally {
      clearInterval(confirmer);
    }
  }

  // ── 3) SAFE-STOP — Rollback scheitert (Worker bleibt ungesund) → failed_safe_stop + Lock ──
  console.log('\n3) Safe-Stop (Rollback scheitert → failed_safe_stop + Safety-Lock):');
  {
    // Heartbeat absichtlich VERALTET → weder Apply- noch Rollback-Health können bestätigen.
    await statusRepo.upsert(CORRELATOR, { lastHeartbeatAt: new Date(Date.now() - 60000).toISOString(), queueProcessingState: 'idle' });
    const plan = await makeFrozenPlan(cfg, applySvc, ctx, { maxChildren: 253 });
    const run = await applyPlan(applySvc, plan.id, ctx);
    check('Apply-Run = failed_safe_stop', run.status === 'failed_safe_stop', `status=${run.status}`);
    check('globaler Safety-Lock gesetzt', (await applyRepo.getSafetyLock()).locked === true);

    // Weiterer Apply-Versuch (frischer Plan) → durch Safety-Lock blockiert.
    const plan2 = await makeFrozenPlan(cfg, applySvc, ctx, { maxChildren: 254 });
    let blocked = false; let code = '';
    try { await applyPlan(applySvc, plan2.id, ctx); } catch (e) { blocked = true; code = e.code || e.statusCode; }
    check('weiterer Apply wird blockiert (Safety-Lock)', blocked, `code=${code}`);
  }

  // Aufräumen: Lock lösen (DB ist ohnehin flüchtig/wird verworfen).
  await applyRepo.setSafetyLock(false, '');

  console.log(`\n=== Ergebnis: ${failures === 0 ? 'ALLE PFADE GRÜN' : `${failures} FEHLER`} ===\n`);
  return failures === 0 ? 0 : 1;
}

main()
  .then(async (code) => { await pool.end().catch(() => {}); process.exit(code); })
  .catch(async (err) => { console.error('SMOKE-FEHLER:', err && err.stack ? err.stack : err); await pool.end().catch(() => {}); process.exit(2); });
