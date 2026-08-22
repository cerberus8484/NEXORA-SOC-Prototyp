'use strict';

// Deployment Center — Phase 4: DeployOrchestrator (Lifecycle, fail-closed).
// Happy-Path + Rollback + Safe-Stop, alles gegen InMemory-Repo + Fake-Connector.

const { DeployOrchestrator } = require('../../src/deploy/DeployOrchestrator');
const { InMemoryDeployRepository } = require('../../src/deploy/InMemoryDeployRepository');
const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');
const { DeploySpec, DeployRun, DEPLOY_RUN_STATUS } = require('../../src/deploy/deployDomain');
const { getModule } = require('../../src/deploy/deployModuleCatalog');

const MODULE = getModule('opnsense');
const TEMPLATE = '9000';

function makeSpec() {
  return DeploySpec.create({
    moduleId: 'opnsense', connectorId: 'c1', targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1',
    resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
    params: { hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254', vlanTag: 10, dns: ['10.0.10.10'] },
    createdBy: 'alice',
  });
}

function allowingCtx(run) {
  return {
    killSwitchEnabled: true, safetyLocked: false, run,
    creatorLabel: 'alice', approverLabel: 'bob',
    reauth: { ok: true, actor: 'bob' }, actor: { label: 'bob' },
    activeRun: false, deployedRun: false,
  };
}

async function seedApprovedRun(repo, spec) {
  const run = DeployRun.plan({ specId: spec.id, startedBy: 'alice' });
  await repo.createRun(run.toJSON());
  run.toApproved('bob');
  await repo.updateRun(run.toJSON());
  return run;
}

function fake(overrides = {}) {
  return new InMemoryProxmoxConnector({ templates: [TEMPLATE], bridges: ['vmbr1'], nextVmid: 1234, ...overrides });
}

describe('DeployOrchestrator — Happy-Path', () => {
  test('deployt end-to-end, setzt VMID, ruft configApplier, auditiert alle Schritte', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const connector = fake();
    const configApplier = jest.fn().mockResolvedValue(undefined);
    const orch = new DeployOrchestrator({ repo });

    const result = await orch.execute({
      run, spec, module: MODULE, connector, templateRef: TEMPLATE, configApplier,
      gateContext: allowingCtx(run), actor: { label: 'bob' },
    });

    expect(result.status).toBe(DEPLOY_RUN_STATUS.DEPLOYED);
    expect(result.vmid).toBe(1234);
    expect(configApplier).toHaveBeenCalledWith(connector, 1234, spec.params);
    const steps = (await repo.listRunSteps(run.id)).map((s) => s.step);
    expect(steps).toEqual(expect.arrayContaining(['clone', 'set_resources', 'attach_network', 'start', 'config_import', 'verify']));
    expect(connector.getVm(1234)).toMatchObject({ status: 'running' });
  });

  test('Audit/Steps enthalten NIE Token oder Passwort', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const orch = new DeployOrchestrator({ repo });
    await orch.execute({ run, spec, module: MODULE, connector: fake(), templateRef: TEMPLATE, configApplier: async () => {}, gateContext: allowingCtx(run), actor: { label: 'bob' } });
    const dump = JSON.stringify([await repo.listDeployAudit(), await repo.listRunSteps(run.id)]);
    expect(dump).not.toMatch(/password|token|enc:v1:/i);
  });
});

describe('DeployOrchestrator — Gate-Denial', () => {
  test('bei deployedRun (Replay) wirft E_REPLAY und schreibt keine Infra', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const connector = fake();
    const orch = new DeployOrchestrator({ repo });
    await expect(orch.execute({
      run, spec, module: MODULE, connector, templateRef: TEMPLATE, configApplier: async () => {},
      gateContext: allowingCtx(run) && { ...allowingCtx(run), deployedRun: true }, actor: { label: 'bob' },
    })).rejects.toMatchObject({ status: 403 });
    expect(connector.getVm(1234)).toBeUndefined(); // nichts geklont
  });
});

describe('DeployOrchestrator — Rollback', () => {
  test('clone-Fehler → rolling_back → rolled_back', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const orch = new DeployOrchestrator({ repo });
    const result = await orch.execute({
      run, spec, module: MODULE, connector: fake({ failOn: { clone: true } }), templateRef: TEMPLATE,
      configApplier: async () => {}, gateContext: allowingCtx(run), actor: { label: 'bob' },
    });
    expect(result.status).toBe(DEPLOY_RUN_STATUS.ROLLED_BACK);
  });

  test('start-Fehler nach clone → Rollback zerstört die VM', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const connector = fake({ failOn: { start: true } });
    const orch = new DeployOrchestrator({ repo });
    const result = await orch.execute({
      run, spec, module: MODULE, connector, templateRef: TEMPLATE, configApplier: async () => {},
      gateContext: allowingCtx(run), actor: { label: 'bob' },
    });
    expect(result.status).toBe(DEPLOY_RUN_STATUS.ROLLED_BACK);
    expect(connector.getVm(1234)).toBeUndefined(); // destroy im Rollback
  });

  test('config-import-Fehler → Rollback', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const connector = fake();
    const orch = new DeployOrchestrator({ repo });
    const result = await orch.execute({
      run, spec, module: MODULE, connector, templateRef: TEMPLATE,
      configApplier: async () => { throw new Error('config-import fehlgeschlagen'); },
      gateContext: allowingCtx(run), actor: { label: 'bob' },
    });
    expect(result.status).toBe(DEPLOY_RUN_STATUS.ROLLED_BACK);
    expect(connector.getVm(1234)).toBeUndefined();
  });
});

describe('DeployOrchestrator — failureReason-Redaktion', () => {
  const SECRET_HEX = '9f8e7d6c5b4a39281706f5e4d3c2b1a0';

  test('roher Fehlertext mit Secrets wird redigiert (run.failureReason + Audit), nicht an Client geleakt', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const orch = new DeployOrchestrator({ repo });

    // configApplier wirft einen Fehler, der einen Proxmox-Token + URL-Credentials trägt.
    const result = await orch.execute({
      run, spec, module: MODULE, connector: fake(), templateRef: TEMPLATE,
      configApplier: async () => {
        throw new Error(`Proxmox 401 PVEAPIToken=root@pam!deploy=${SECRET_HEX} bei https://user:sup3rpw@10.0.99.100:8006`);
      },
      gateContext: allowingCtx(run), actor: { label: 'bob' },
    });

    expect(result.status).toBe(DEPLOY_RUN_STATUS.ROLLED_BACK);
    // Kein Token, keine URL-Credentials im an den Client zurückgegebenen failureReason.
    expect(result.failureReason).not.toContain(SECRET_HEX);
    expect(result.failureReason).not.toMatch(/user:sup3rpw@/);
    expect(result.failureReason).toContain('[redacted]');
    // Auch das (client-sichtbare) Deploy-Audit ist redigiert.
    const auditDump = JSON.stringify(await repo.listDeployAudit());
    expect(auditDump).not.toContain(SECRET_HEX);
    expect(auditDump).not.toMatch(/sup3rpw/);
  });
});

describe('DeployOrchestrator — Safe-Stop', () => {
  test('Rollback-Fehler (destroy scheitert) → failed_safe_stop + globale Sperre', async () => {
    const repo = new InMemoryDeployRepository();
    const spec = makeSpec();
    const run = await seedApprovedRun(repo, spec);
    const connector = fake({ failOn: { start: true, destroy: true } });
    const orch = new DeployOrchestrator({ repo });
    const result = await orch.execute({
      run, spec, module: MODULE, connector, templateRef: TEMPLATE, configApplier: async () => {},
      gateContext: allowingCtx(run), actor: { label: 'bob' },
    });
    expect(result.status).toBe(DEPLOY_RUN_STATUS.FAILED_SAFE_STOP);
    expect((await repo.getSafetyLock()).locked).toBe(true);
  });
});
