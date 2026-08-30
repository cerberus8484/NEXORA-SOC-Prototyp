'use strict';

// Deployment Center — Phase 4: DeployService (verdrahtet Kataloge, Validierung,
// Repo, Reauth, Gates, Orchestrator). Fake-Connector + Stub-Auth → kein Netz.

const { DeployService } = require('../../src/deploy/DeployService');
const { InMemoryDeployRepository } = require('../../src/deploy/InMemoryDeployRepository');
const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');

const TEMPLATE = 9000;

function connectorFactory() {
  return new InMemoryProxmoxConnector({ templates: [String(TEMPLATE)], bridges: ['vmbr1'], nextVmid: 1234 });
}

const stubAuth = {
  verifyDeployReauth: (token, sub) => ({ ok: token === 'good' && sub === 'u1', sub }),
};

function makeService({ isDeployEnabled = () => true, configAppliers = {} } = {}) {
  const repo = new InMemoryDeployRepository();
  const svc = new DeployService({ repo, authService: stubAuth, connectorFactory, isDeployEnabled, configAppliers });
  return { repo, svc };
}

const CONNECTOR_INPUT = {
  type: 'proxmox', name: 'Lab-PVE', host: '10.0.99.100', apiToken: 'root@pam!x=secret',
  targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true,
};

function specInput(connectorId) {
  return {
    moduleId: 'opnsense', connectorId, targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1',
    resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
    params: {
      hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254',
      vlanTag: 10, dns: ['10.0.10.10'], templateVmid: TEMPLATE,
    },
  };
}

async function seedConnectorAndSpec(svc) {
  const conn = await svc.createConnector(CONNECTOR_INPUT, { label: 'alice', id: 'u1' }, 'good');
  const spec = await svc.createSpec(specInput(conn.id), { label: 'alice' });
  return { conn, spec };
}

describe('DeployService — Connector + Spec anlegen', () => {
  test('createConnector persistiert ohne Token-Leak', async () => {
    const { svc } = makeService();
    const conn = await svc.createConnector(CONNECTOR_INPUT, { label: 'alice', id: 'u1' }, 'good');
    expect(conn.id).toBeTruthy();
    expect(JSON.stringify(conn)).not.toContain('secret');
    expect(conn).not.toHaveProperty('apiToken');
    expect(conn).not.toHaveProperty('apiTokenEnc');
  });

  test('createSpec validiert Params + ist idempotent (gleicher Hash → gleiche Spec)', async () => {
    const { svc } = makeService();
    const conn = await svc.createConnector(CONNECTOR_INPUT, { label: 'alice', id: 'u1' }, 'good');
    const a = await svc.createSpec(specInput(conn.id), { label: 'alice' });
    const b = await svc.createSpec(specInput(conn.id), { label: 'alice' });
    expect(a.id).toBe(b.id);
    expect(a.specHash).toBe(b.specHash);
  });

  test('unbekanntes Modul → Fehler', async () => {
    const { svc } = makeService();
    const conn = await svc.createConnector(CONNECTOR_INPUT, { label: 'alice', id: 'u1' }, 'good');
    await expect(svc.createSpec({ ...specInput(conn.id), moduleId: 'nope' }, { label: 'alice' })).rejects.toThrow();
  });

  test('unbekannter Connector → Fehler', async () => {
    const { svc } = makeService();
    await expect(svc.createSpec(specInput('does-not-exist'), { label: 'alice' })).rejects.toThrow();
  });

  test('ungültige Params (VLAN 4095) → Fehler', async () => {
    const { svc } = makeService();
    const conn = await svc.createConnector(CONNECTOR_INPUT, { label: 'alice', id: 'u1' }, 'good');
    const bad = specInput(conn.id); bad.params.vlanTag = 4095;
    await expect(svc.createSpec(bad, { label: 'alice' })).rejects.toThrow(/vlanTag/);
  });
});

describe('DeployService — plan (Dry-Run) + approve (Vier-Augen)', () => {
  test('plan liefert Preconditions und legt einen planned Run an (kein Infra-Write)', async () => {
    const { svc } = makeService();
    const { spec } = await seedConnectorAndSpec(svc);
    const { run, preconditions } = await svc.plan(spec.id, { label: 'alice' });
    expect(run.status).toBe('planned');
    expect(preconditions.ok).toBe(true);
  });

  test('approve durch den Ersteller → Vier-Augen-Fehler', async () => {
    const { svc } = makeService();
    const { spec } = await seedConnectorAndSpec(svc);
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await expect(svc.approve(run.id, { label: 'alice' })).rejects.toMatchObject({ status: 403 });
  });

  test('approve durch anderen Admin → approved', async () => {
    const { svc } = makeService();
    const { spec } = await seedConnectorAndSpec(svc);
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    const approved = await svc.approve(run.id, { label: 'bob' });
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('bob');
  });

  test('approve durch gleiche User-ID (anderes Label) → Vier-Augen-Fehler', async () => {
    const { svc } = makeService();
    const { spec } = await seedConnectorAndSpec(svc);
    const { run } = await svc.plan(spec.id, { id: 'u1', label: 'alice@x' });
    // Gleicher Account (id u1), aber abweichende Label-Schreibweise → muss ablehnen.
    await expect(svc.approve(run.id, { id: 'u1', label: 'Alice@x' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('DeployService — apply (Gates + Orchestrator + Reauth)', () => {
  async function readyRun(svc) {
    const { spec } = await seedConnectorAndSpec(svc);
    const { run } = await svc.plan(spec.id, { label: 'alice' });
    await svc.approve(run.id, { label: 'bob' });
    return run;
  }

  test('gültiger Reauth + Gate AN → deployed', async () => {
    const { svc } = makeService({ isDeployEnabled: () => true });
    const run = await readyRun(svc);
    const result = await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(result.status).toBe('deployed');
  });

  test('Gate AUS (DEPLOY_ENABLED=false) → 403 E_DEPLOY_DISABLED', async () => {
    const { svc } = makeService({ isDeployEnabled: () => false });
    const run = await readyRun(svc);
    await expect(svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good'))
      .rejects.toMatchObject({ status: 403, code: 'E_DEPLOY_DISABLED' });
  });

  test('fehlender/falscher Reauth → 403 E_REAUTH', async () => {
    const { svc } = makeService({ isDeployEnabled: () => true });
    const run = await readyRun(svc);
    await expect(svc.apply(run.id, { id: 'u1', label: 'bob' }, 'bad-token'))
      .rejects.toMatchObject({ status: 403, code: 'E_REAUTH' });
  });

  test('configApplier wird beim Apply aufgerufen', async () => {
    const applier = jest.fn().mockResolvedValue(undefined);
    const { svc } = makeService({ isDeployEnabled: () => true, configAppliers: { 'opnsense-config-import': applier } });
    const run = await readyRun(svc);
    await svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good');
    expect(applier).toHaveBeenCalled();
  });

  test('TOCTOU: verliert der Apply das Single-Flight-Rennen (Repo-Konflikt beim toApplying) → 409, nicht 500', async () => {
    const { repo, svc } = makeService({ isDeployEnabled: () => true });
    const run = await readyRun(svc);
    // Simuliere das Race-Fenster: der Gate-Vorabcheck (findActiveRun) sah keinen
    // aktiven Run, aber beim toApplying wirft der Repo-Backstop den Single-Flight-
    // Konflikt (plain Error mit .code, wie der Partial-Unique-Index in Postgres).
    const realUpdate = repo.updateRun.bind(repo);
    repo.updateRun = async (r) => {
      if (r.status === 'applying') {
        throw Object.assign(new Error('es läuft bereits ein aktiver Deploy-Run'), { code: 'ACTIVE_RUN_CONFLICT' });
      }
      return realUpdate(r);
    };
    await expect(svc.apply(run.id, { id: 'u1', label: 'bob' }, 'good'))
      .rejects.toMatchObject({ status: 409, code: 'ACTIVE_RUN_CONFLICT' });
  });
});
