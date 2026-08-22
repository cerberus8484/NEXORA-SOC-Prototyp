'use strict';

// Slice 3: nach einem erfolgreichen vm-clone-SERVER-Deploy wird die VM als persistenter
// Managed-Node registriert („für immer da"). Getestet wird der Gating-Hook direkt:
// nur bei terminalem 'deployed' + module.type==='server'; Rollback/Firewall/kein-Registrar
// registrieren nichts; ein Registrar-Fehler kippt den Deploy NICHT (best-effort, auditiert).

const { DeployService } = require('../../src/deploy/DeployService');

function makeSvc(nodeRegistrar, hostKeyScanner) {
  const audits = [];
  const repo = { appendDeployAudit: async (a) => { audits.push(a); } };
  const svc = new DeployService({
    repo,
    authService: { verifyDeployReauth: () => ({ ok: true }) },
    connectorFactory: () => ({}),
    nodeRegistrar,
    hostKeyScanner,
  });
  return { svc, audits };
}

const WIN = { id: 'windows-server', type: 'server' };
const FW = { id: 'opnsense', type: 'firewall' };
const specStatic = { id: 's1', params: { hostname: 'win01', ipMode: 'static', staticIp: '10.0.10.50' } };
const deployed = { id: 'r1', status: 'deployed' };

describe('DeployService._maybeRegisterDeployedNode — Node-Registrierung nach Deploy', () => {
  test('deployed + Server-Modul → registriert (role/os/ip/caps) + Audit deploy.node.registered', async () => {
    const calls = [];
    const { svc, audits } = makeSvc(async (d) => { calls.push(d); });
    await svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, { label: 'alice' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      hostname: 'win01', role: 'normal_agent', os: 'windows', ip: '10.0.10.50',
      capabilities: ['version_report', 'update_status'],
    });
    expect(audits.some((a) => a.type === 'deploy.node.registered')).toBe(true);
  });

  test('rolled_back → registriert NICHT (nur Erfolg)', async () => {
    const calls = [];
    const { svc } = makeSvc(async (d) => { calls.push(d); });
    await svc._maybeRegisterDeployedNode(WIN, specStatic, { id: 'r', status: 'rolled_back' }, {});
    expect(calls).toHaveLength(0);
  });

  test('Firewall-Modul (type≠server) → registriert NICHT', async () => {
    const calls = [];
    const { svc } = makeSvc(async (d) => { calls.push(d); });
    await svc._maybeRegisterDeployedNode(FW, specStatic, deployed, {});
    expect(calls).toHaveLength(0);
  });

  test('ohne nodeRegistrar → No-op (kein Crash)', async () => {
    const { svc } = makeSvc(undefined);
    await expect(svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, {})).resolves.toBeUndefined();
  });

  test('dhcp → ip null (kein staticIp)', async () => {
    const calls = [];
    const { svc } = makeSvc(async (d) => { calls.push(d); });
    await svc._maybeRegisterDeployedNode(WIN, { id: 's2', params: { hostname: 'win02', ipMode: 'dhcp' } }, deployed, {});
    expect(calls[0].ip).toBeNull();
  });

  test('Registrar wirft → Deploy NICHT gekippt; register_failed auditiert, kein Roh-Fehler', async () => {
    const { svc, audits } = makeSvc(async () => { throw new Error('provisioning down /secret'); });
    await expect(svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, {})).resolves.toBeUndefined();
    expect(audits.some((a) => a.type === 'deploy.node.register_failed')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('provisioning down');
  });
});

describe('DeployService — Host-Key-Auto-Capture (Slice 6c, Option 1, best-effort)', () => {
  const PIN = 'd'.repeat(64);

  test('Scanner liefert Pin → Re-Register mit hostKeyPin + hostkey_pinned-Audit', async () => {
    const calls = [];
    const { svc, audits } = makeSvc(async (d) => { calls.push(d); }, async () => PIN);
    await svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, {});
    expect(calls).toHaveLength(2); // 1) Register ohne Pin  2) Re-Register mit Pin
    expect(calls[1]).toMatchObject({ hostname: 'win01', hostKeyPin: PIN, ip: '10.0.10.50' });
    expect(audits.some((a) => a.type === 'deploy.node.hostkey_pinned')).toBe(true);
  });

  test('Scanner scheitert (OpenSSH noch nicht up) → hostkey_deferred(scan_failed), kein 2. Register, Deploy NICHT gekippt', async () => {
    const calls = [];
    const { svc, audits } = makeSvc(async (d) => { calls.push(d); }, async () => { throw new Error('ECONNREFUSED'); });
    await svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, {});
    expect(calls).toHaveLength(1);
    expect(audits.some((a) => a.type === 'deploy.node.hostkey_deferred' && a.detail.reason === 'scan_failed')).toBe(true);
  });

  test('DHCP (keine IP) → Scanner NICHT gerufen, hostkey_deferred(no_ip)', async () => {
    let scanned = 0;
    const { svc, audits } = makeSvc(async () => {}, async () => { scanned += 1; return PIN; });
    await svc._maybeRegisterDeployedNode(WIN, { id: 's', params: { hostname: 'win-dhcp', ipMode: 'dhcp' } }, deployed, {});
    expect(scanned).toBe(0);
    expect(audits.some((a) => a.type === 'deploy.node.hostkey_deferred' && a.detail.reason === 'no_ip')).toBe(true);
  });

  test('ohne Scanner → kein Auto-Capture (nur Registrierung)', async () => {
    const calls = [];
    const { svc, audits } = makeSvc(async (d) => { calls.push(d); });
    await svc._maybeRegisterDeployedNode(WIN, specStatic, deployed, {});
    expect(calls).toHaveLength(1);
    expect(audits.some((a) => a.type.startsWith('deploy.node.hostkey'))).toBe(false);
  });
});
