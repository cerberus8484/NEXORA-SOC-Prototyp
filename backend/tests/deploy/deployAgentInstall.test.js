'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2b — agent-install-Pfad (Linux-Client / Wazuh-Agent per ssh-systemd):
// Domain (requirePlacement + FSM-Edge), Orchestrator.executeAgentInstall (Gates/
// Erfolg/Fehlschlag/fail-closed) und DeployService end-to-end (createSpec→plan→
// approve→apply) mit injiziertem Fake-SSH-Runner. Kein Netz, kein echter Transport.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DeploySpec, DeployRun } = require('../../src/deploy/deployDomain');
const { DeployOrchestrator } = require('../../src/deploy/DeployOrchestrator');
const { DeployService } = require('../../src/deploy/DeployService');
const { InMemoryDeployRepository } = require('../../src/deploy/InMemoryDeployRepository');
const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');
const { SshDeployConnector } = require('../../src/deploy/sshDeployConnectorDomain');
const { makeSshRunner } = require('../../src/deploy/connectors/sshRunnerFactory');

// ── Domain ───────────────────────────────────────────────────────────────────
describe('deployDomain — agent-install-Anpassungen', () => {
  test('DeploySpec.create({requirePlacement:false}) erlaubt fehlendes Node/Storage/Bridge', () => {
    const spec = DeploySpec.create(
      { moduleId: 'linux-client', connectorId: 'ssh1', params: { targetHost: '10.0.10.90' } },
      { requirePlacement: false },
    );
    expect(spec.moduleId).toBe('linux-client');
    expect(spec.specHash).toBeTruthy();
  });

  test('requirePlacement bleibt Default true (vm-clone erzwingt weiterhin Placement)', () => {
    expect(() => DeploySpec.create({ moduleId: 'opnsense', connectorId: 'c', params: {} }))
      .toThrow(/targetNode|storage|bridge/);
  });

  test('FSM erlaubt den atomaren Pfad approved → applying → deployed', () => {
    const run = DeployRun.plan({ specId: 's1', startedBy: 'alice' });
    run.toApproved('bob');
    run.toApplying();
    expect(() => run.toDeployed()).not.toThrow();
    expect(run.status).toBe('deployed');
  });
});

// ── Orchestrator ───────────────────────────────────────────────────────────────
function approvedRun(repo, specId = 's1') {
  const run = DeployRun.plan({ specId, startedBy: 'alice', startedById: 'u-alice' });
  run.toApproved('bob', 'u-bob');
  return run;
}
const specStub = (params = { targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }) =>
  ({ id: 's1', connectorId: 'ssh1', params });
const passGate = {
  killSwitchEnabled: true, safetyLocked: false, run: { status: 'approved' },
  creatorLabel: 'alice', approverLabel: 'bob', creatorId: 'u-alice', approverId: 'u-bob',
  reauth: { ok: true, actor: 'bob' }, actor: { id: 'u-bob', label: 'bob' },
  activeRun: false, deployedRun: false,
};

describe('DeployOrchestrator.executeAgentInstall', () => {
  test('Erfolg: Installer ok → run deployed + step agent_install ok + Audit deployed', async () => {
    const repo = new InMemoryDeployRepository();
    const orch = new DeployOrchestrator({ repo });
    const run = approvedRun(repo);
    await repo.createRun(run.toJSON());
    const buildInstaller = () => async (p) => ({ ok: true, installed: true, host: p.targetHost, agentName: 'web01' });

    const res = await orch.executeAgentInstall({ run, spec: specStub(), buildInstaller, gateContext: passGate, actor: { label: 'bob' } });

    expect(res.status).toBe('deployed');
    const steps = await repo.listRunSteps(run.id);
    expect(steps.find((s) => s.step === 'agent_install' && s.status === 'ok')).toBeTruthy();
    const audit = await repo.listDeployAudit({ runId: run.id });
    expect(audit.some((a) => a.type === 'deploy.deployed')).toBe(true);
  });

  test('Gate abgelehnt (Kill-Switch aus) → 403, run NICHT deployed', async () => {
    const repo = new InMemoryDeployRepository();
    const orch = new DeployOrchestrator({ repo });
    const run = approvedRun(repo);
    await repo.createRun(run.toJSON());
    const buildInstaller = jest.fn();

    await expect(orch.executeAgentInstall({
      run, spec: specStub(), buildInstaller, gateContext: { ...passGate, killSwitchEnabled: false }, actor: { label: 'bob' },
    })).rejects.toMatchObject({ status: 403 });
    expect(buildInstaller).not.toHaveBeenCalled(); // Runner wird bei Gate-Deny NIE gebaut
  });

  test('Installer meldet Fehlschlag → rolled_back (idempotent, kein destroy), kein Wurf', async () => {
    const repo = new InMemoryDeployRepository();
    const orch = new DeployOrchestrator({ repo });
    const run = approvedRun(repo);
    await repo.createRun(run.toJSON());
    const buildInstaller = () => async () => ({ ok: false, reason: 'install_failed' });

    const res = await orch.executeAgentInstall({ run, spec: specStub(), buildInstaller, gateContext: passGate, actor: { label: 'bob' } });
    expect(res.status).toBe('rolled_back');
  });

  test('buildInstaller wirft (Connector nicht konfiguriert) → fail-closed rolled_back, kein Leak des rohen Grunds', async () => {
    const repo = new InMemoryDeployRepository();
    const orch = new DeployOrchestrator({ repo });
    const run = approvedRun(repo);
    await repo.createRun(run.toJSON());
    const buildInstaller = () => { throw new Error('SSH key=/root/.ssh/id_ed25519 secret=abcdef0123456789abcdef'); };

    const res = await orch.executeAgentInstall({ run, spec: specStub(), buildInstaller, gateContext: passGate, actor: { label: 'bob' } });
    expect(res.status).toBe('rolled_back');
    expect(JSON.stringify(res)).not.toContain('id_ed25519');
  });
});

// ── Service end-to-end ─────────────────────────────────────────────────────────
const stubAuth = { verifyDeployReauth: (token, sub) => ({ ok: token === 'good' && sub === 'u1', sub }) };
function connectorFactory() { return new InMemoryProxmoxConnector({ templates: ['9000'], bridges: ['vmbr1'], nextVmid: 1 }); }

async function seedLinuxClient(svc, repo) {
  // SSH-Connector-Zeile direkt seeden (echter, verschlüsselter SSH-Connector-Typ = nächster Slice).
  await repo.createConnector({ id: 'ssh1', type: 'ssh', name: 'lab-ssh', host: '10.0.10.90' });
  const spec = await svc.createSpec({
    moduleId: 'linux-client', connectorId: 'ssh1',
    params: { targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', agentName: 'web01' },
  }, { label: 'alice' });
  return spec;
}

function makeSvc({ isDeployEnabled = () => true, sshRunnerFactory } = {}) {
  const repo = new InMemoryDeployRepository();
  const svc = new DeployService({ repo, authService: stubAuth, connectorFactory, isDeployEnabled, sshRunnerFactory });
  return { repo, svc };
}

describe('DeployService — Linux-Client (agent-install) end-to-end', () => {
  test('createSpec ohne Placement + plan (Dry-Run ohne SSH) + apply mit Fake-Runner → deployed', async () => {
    const okRunner = async () => ({ code: 0, timedOut: false });
    const { repo, svc } = makeSvc({ sshRunnerFactory: () => okRunner });
    const spec = await seedLinuxClient(svc, repo);

    const { run, preconditions } = await svc.plan(spec.id, { label: 'alice' });
    expect(run.status).toBe('planned');
    expect(preconditions).toMatchObject({ ok: true, kind: 'agent-install', targetHost: '10.0.10.90' });

    await svc.approve(run.id, { id: 'u2', label: 'bob' });
    const result = await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(result.status).toBe('deployed');
  });

  test('ohne konfigurierten SSH-Connector (Default-Factory) → fail-closed rolled_back, NICHT deployed', async () => {
    const { repo, svc } = makeSvc({}); // Default-sshRunnerFactory wirft „nicht konfiguriert"
    const spec = await seedLinuxClient(svc, repo);
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await svc.approve(run.id, { id: 'u2', label: 'bob' });
    const result = await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(result.status).toBe('rolled_back');
  });

  test('Kill-Switch aus (DEPLOY_ENABLED=false) → 403, Runner nie gebaut', async () => {
    const built = jest.fn(() => async () => ({ code: 0 }));
    const { repo, svc } = makeSvc({ isDeployEnabled: () => false, sshRunnerFactory: built });
    const spec = await seedLinuxClient(svc, repo);
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await svc.approve(run.id, { id: 'u2', label: 'bob' });
    await expect(svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good')).rejects.toMatchObject({ status: 403, code: 'E_DEPLOY_DISABLED' });
    expect(built).not.toHaveBeenCalled();
  });
});

// ── End-to-end über die ECHTE makeSshRunner-Factory (nur der ssh2-Client ist Fake) ──
describe('DeployService — Linux-Client über echte SSH-Connector-Factory', () => {
  const HOST = '10.0.10.90';
  const SERVER_KEY = Buffer.from('server-host-key-e2e');
  const PIN = crypto.createHash('sha256').update(SERVER_KEY).digest('hex');
  const PRIV = '-----BEGIN OPENSSH PRIVATE KEY-----\nE2E\n-----END OPENSSH PRIVATE KEY-----';

  const fakeSsh = () => () => {
    const client = new EventEmitter();
    client.connect = (cfg) => setImmediate(() => cfg.hostVerifier(SERVER_KEY, (ok) => (ok ? client.emit('ready') : client.emit('error', new Error('pin')))));
    client.exec = (cmd, cb) => {
      const stream = new EventEmitter(); stream.stderr = new EventEmitter();
      stream.write = () => {}; stream.end = () => {};
      cb(null, stream); setImmediate(() => stream.emit('close', 0));
    };
    client.end = () => {};
    return client;
  };

  test('verschlüsselter SSH-Connector + Fake-Transport → deployed (ganze Kette)', async () => {
    const repo = new InMemoryDeployRepository();
    const svc = new DeployService({
      repo, authService: stubAuth, connectorFactory, isDeployEnabled: () => true,
      sshRunnerFactory: (row) => makeSshRunner(row, { createClient: fakeSsh() }),
    });
    // Echten, verschlüsselten SSH-Connector persistieren.
    const conn = SshDeployConnector.create({ name: 'web01', host: HOST, sshUser: 'deploy', privateKey: PRIV, hostKeyPin: PIN });
    await repo.createConnector(conn.toRow());
    const spec = await svc.createSpec({
      moduleId: 'linux-client', connectorId: conn.id,
      params: { targetHost: HOST, wazuhManager: '10.0.10.77', agentName: 'web01' },
    }, { label: 'alice' });

    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await svc.approve(run.id, { id: 'u2', label: 'bob' });
    const result = await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(result.status).toBe('deployed');
  });

  test('Host-Key-Mismatch (falscher Pin) → fail-closed rolled_back, NICHT deployed', async () => {
    const repo = new InMemoryDeployRepository();
    const svc = new DeployService({
      repo, authService: stubAuth, connectorFactory, isDeployEnabled: () => true,
      sshRunnerFactory: (row) => makeSshRunner(row, { createClient: fakeSsh() }),
    });
    const wrongPin = crypto.createHash('sha256').update(Buffer.from('anderer-key')).digest('hex');
    const conn = SshDeployConnector.create({ name: 'web01', host: HOST, privateKey: PRIV, hostKeyPin: wrongPin });
    await repo.createConnector(conn.toRow());
    const spec = await svc.createSpec({
      moduleId: 'linux-client', connectorId: conn.id,
      params: { targetHost: HOST, wazuhManager: '10.0.10.77' },
    }, { label: 'alice' });
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await svc.approve(run.id, { id: 'u2', label: 'bob' });
    const result = await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(result.status).toBe('rolled_back');
  });
});
