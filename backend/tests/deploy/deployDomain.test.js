'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Phase 1: Deploy-Domain (rein, keine DB/HTTP/Ausführung).
//   DeploySpec — immutabler, gehashter Deploy-Wunsch (Modul/Connector/Netz/Params).
//   DeployRun  — Lifecycle-State-Machine (fail-closed) inkl. Rollback/Safe-Stop.
// Secrets (adminPassword) dürfen NIE im Spec-JSON oder Spec-Hash landen.
// ─────────────────────────────────────────────────────────────────────────

const {
  DeploySpec, DeployRun, DEPLOY_RUN_STATUS, computeSpecHash, canonical,
} = require('../../src/deploy/deployDomain');

function validSpecInput(overrides = {}) {
  return {
    moduleId: 'opnsense',
    connectorId: 'conn-1',
    targetNode: 'pve1',
    storage: 'local-lvm',
    bridge: 'vmbr1',
    resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
    params: {
      hostname: 'fw-lab',
      ipMode: 'static',
      staticIp: '10.0.10.1',
      cidr: 24,
      gateway: '10.0.10.254',
      vlanTag: 10,
      dns: ['10.0.10.10'],
    },
    createdBy: 'admin',
    ...overrides,
  };
}

describe('computeSpecHash — deterministisch + secret-frei', () => {
  test('gleiche Eingabe → gleicher Hash, Feldreihenfolge egal', () => {
    const a = computeSpecHash({ moduleId: 'opnsense', connectorId: 'c', params: { b: 1, a: 2 } });
    const b = computeSpecHash({ moduleId: 'opnsense', connectorId: 'c', params: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  test('Wertänderung → anderer Hash', () => {
    const a = computeSpecHash({ moduleId: 'opnsense', params: { vlanTag: 10 } });
    const b = computeSpecHash({ moduleId: 'opnsense', params: { vlanTag: 20 } });
    expect(a).not.toBe(b);
  });

  test('adminPassword fließt NICHT in den Hash ein (defensiv gestrippt)', () => {
    const withPw = computeSpecHash({ moduleId: 'opnsense', params: { vlanTag: 10, adminPassword: 'geheim!' } });
    const without = computeSpecHash({ moduleId: 'opnsense', params: { vlanTag: 10 } });
    expect(withPw).toBe(without);
  });

  test('verschachtelte Secrets werden ebenfalls gestrippt', () => {
    const a = computeSpecHash({ params: { lan: { vlanTag: 10, apiKey: 'x' } } });
    const b = computeSpecHash({ params: { lan: { vlanTag: 10 } } });
    expect(a).toBe(b);
  });
});

describe('canonical — stabile Serialisierung', () => {
  test('sortiert Objekt-Schlüssel rekursiv', () => {
    expect(canonical({ b: 1, a: { d: 4, c: 3 } })).toBe(canonical({ a: { c: 3, d: 4 }, b: 1 }));
  });
});

describe('DeploySpec — immutabler Snapshot', () => {
  test('create setzt specHash konsistent zu computeSpecHash (ohne Secrets)', () => {
    const spec = DeploySpec.create(validSpecInput());
    expect(spec.specHash).toBe(
      computeSpecHash({
        moduleId: 'opnsense', connectorId: 'conn-1', targetNode: 'pve1',
        storage: 'local-lvm', bridge: 'vmbr1',
        resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
        params: validSpecInput().params,
      }),
    );
    expect(spec.id).toBeTruthy();
    expect(spec.createdAt).toBeTruthy();
  });

  test('wirft bei fehlenden Pflichtfeldern', () => {
    expect(() => DeploySpec.create(validSpecInput({ moduleId: '' }))).toThrow(/moduleId/);
    expect(() => DeploySpec.create(validSpecInput({ connectorId: '' }))).toThrow(/connectorId/);
    expect(() => DeploySpec.create(validSpecInput({ targetNode: '' }))).toThrow(/targetNode/);
    expect(() => DeploySpec.create(validSpecInput({ bridge: '' }))).toThrow(/bridge/);
  });

  test('lehnt adminPassword in den persistierten params ab (write-only, nie im Spec)', () => {
    const bad = validSpecInput();
    bad.params = { ...bad.params, adminPassword: 'geheim!' };
    expect(() => DeploySpec.create(bad)).toThrow(/secret|password|adminPassword/i);
  });

  test('toJSON enthält keine Secret-Felder und keinen Token', () => {
    const spec = DeploySpec.create(validSpecInput());
    const json = JSON.stringify(spec.toJSON());
    expect(json).not.toMatch(/adminPassword/i);
    expect(json).not.toMatch(/geheim/);
  });

  test('trägt KEINE Mutationsmethode', () => {
    const spec = DeploySpec.create(validSpecInput());
    for (const m of ['apply', 'mutate', 'setParams', 'update']) {
      expect(typeof spec[m]).not.toBe('function');
    }
  });
});

describe('DeployRun — Lifecycle State-Machine (fail-closed)', () => {
  function newRun() { return DeployRun.plan({ specId: 's1', startedBy: 'admin' }); }

  test('startet in planned', () => {
    expect(newRun().status).toBe(DEPLOY_RUN_STATUS.PLANNED);
  });

  test('Erfolgspfad planned→approved→applying→cloning→starting→configuring→verifying→deployed', () => {
    const r = newRun();
    r.toApproved('reviewer');
    expect(r.status).toBe(DEPLOY_RUN_STATUS.APPROVED);
    expect(r.approvedBy).toBe('reviewer');
    r.toApplying();
    r.toCloning();
    r.setVmid(1234);
    expect(r.vmid).toBe(1234);
    r.toStarting();
    r.toConfiguring();
    r.toVerifying();
    r.toDeployed();
    expect(r.status).toBe(DEPLOY_RUN_STATUS.DEPLOYED);
    expect(r.finishedAt).toBeTruthy();
    expect(r.isTerminal()).toBe(true);
  });

  test('Fehlerpfad ab cloning → rolling_back → rolled_back', () => {
    const r = newRun();
    r.toApproved('rev'); r.toApplying(); r.toCloning();
    r.toRollingBack('clone failed');
    expect(r.status).toBe(DEPLOY_RUN_STATUS.ROLLING_BACK);
    expect(r.failureReason).toMatch(/clone failed/);
    r.toRolledBack();
    expect(r.status).toBe(DEPLOY_RUN_STATUS.ROLLED_BACK);
    expect(r.isTerminal()).toBe(true);
  });

  test('Rollback-Versagen → failed_safe_stop', () => {
    const r = newRun();
    r.toApproved('rev'); r.toApplying(); r.toCloning();
    r.toRollingBack('start failed');
    r.toFailedSafeStop('destroy failed');
    expect(r.status).toBe(DEPLOY_RUN_STATUS.FAILED_SAFE_STOP);
    expect(r.failureReason).toMatch(/destroy failed/);
    expect(r.isTerminal()).toBe(true);
  });

  test('ungültiger Übergang wirft (kein stiller Fehlzustand)', () => {
    const r = newRun();
    expect(() => r.toDeployed()).toThrow();        // planned → deployed direkt verboten
    r.toApproved('rev'); r.toApplying(); r.toCloning(); r.toStarting();
    r.toConfiguring(); r.toVerifying(); r.toDeployed();
    expect(() => r.toRollingBack('x')).toThrow();  // deployed ist terminal
  });

  test('Apply ohne vorheriges Approve ist NICHT erlaubt', () => {
    const r = newRun();
    expect(() => r.toApplying()).toThrow();         // planned → applying direkt verboten
  });

  test('toJSON enthält den Lifecycle, keine Secrets', () => {
    const r = newRun();
    r.toApproved('rev');
    const json = r.toJSON();
    expect(json).toMatchObject({ specId: 's1', status: DEPLOY_RUN_STATUS.APPROVED, startedBy: 'admin', approvedBy: 'rev' });
    expect(JSON.stringify(json)).not.toMatch(/password|token/i);
  });
});
