'use strict';

// Slice 4 („updatebar"): gated Update-Action für einen verwalteten Windows-Node.
// Getestet: Arm-Flag + Reauth fail-closed, Host AUS DER REGISTRY (nie Nutzereingabe),
// fester Update-scriptId, fail-safe Default-Runner, Audit (denied/ran/failed).

const { NodeUpdateService, NodeUpdateError, UPDATE_SCRIPT_ID } = require('../../src/services/nodeUpdateService');

const WIN_NODE = { id: 'n1', name: 'win01', os: 'windows', ip: '10.0.10.50', status: 'enrolled' };

function build({ node = WIN_NODE, armed = true, reauthOk = true, runner, runnerFactory, hostKeyScanner } = {}) {
  const audits = [];
  const calls = [];
  const updates = [];
  const repo = {
    getNode: async (id) => (node && id === node.id ? node : null),
    updateNode: async (id, patch) => { updates.push({ id, patch }); return { ...(node || {}), ...patch }; },
  };
  const auth = { verifyDeployReauth: async () => ({ ok: reauthOk }) };
  const defaultRunner = async (opts) => { calls.push(opts); return { code: 0 }; };
  const svc = new NodeUpdateService({
    provisioningRepo: repo,
    authService: auth,
    isUpdateEnabled: () => armed,
    runnerFactory: runnerFactory !== undefined ? runnerFactory : (() => runner || defaultRunner),
    hostKeyScanner,
    audit: async (type, detail) => { audits.push({ type, detail }); },
  });
  return { svc, audits, calls, updates };
}

const OK_OPTS = { actor: { id: 'u1', label: 'alice' }, reauthToken: 'good' };

describe('NodeUpdateService.updateNode — Gating (fail-closed)', () => {
  test('nicht scharfgeschaltet → E_NOT_ARMED, Runner NICHT gerufen, denied auditiert', async () => {
    const { svc, audits, calls } = build({ armed: false });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_NOT_ARMED' });
    expect(calls).toHaveLength(0);
    expect(audits.some((a) => a.type === 'node.update.denied' && a.detail.reason === 'not_armed')).toBe(true);
  });

  test('Reauth fehlgeschlagen → E_REAUTH, Runner NICHT gerufen, denied auditiert', async () => {
    const { svc, audits, calls } = build({ reauthOk: false });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_REAUTH' });
    expect(calls).toHaveLength(0);
    expect(audits.some((a) => a.type === 'node.update.denied' && a.detail.reason === 'reauth')).toBe(true);
  });

  test('ungültige agentVersion → E_BAD_VERSION (Defense-in-Depth)', async () => {
    const { svc } = build();
    await expect(svc.updateNode('n1', { ...OK_OPTS, agentVersion: '4.14; rm' })).rejects.toMatchObject({ code: 'E_BAD_VERSION' });
  });
});

describe('NodeUpdateService.updateNode — Node-Auflösung + Ausführung', () => {
  test('unbekannter Node → E_NOT_FOUND', async () => {
    const { svc } = build();
    await expect(svc.updateNode('nope', OK_OPTS)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  test('Unbekanntes OS (weder Windows noch Linux) → E_UNSUPPORTED (fail-closed)', async () => {
    for (const os of ['darwin', 'freebsd', '', null]) {
      const { svc } = build({ node: { ...WIN_NODE, os } });
      // eslint-disable-next-line no-await-in-loop
      await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    }
  });

  test('Windows-Node → Runner bekommt Windows-Skript + Administrator', async () => {
    const { svc, calls } = build();
    await svc.updateNode('n1', OK_OPTS);
    expect(calls[0]).toMatchObject({ scriptId: 'update-wazuh-agent-windows', user: 'Administrator' });
  });

  test('Linux-Node → Runner bekommt Linux-Skript + root (Bash-Installer)', async () => {
    const { svc, calls } = build({ node: { ...WIN_NODE, os: 'linux' } });
    await svc.updateNode('n1', OK_OPTS);
    expect(calls[0]).toMatchObject({ scriptId: 'update-wazuh-agent', user: 'root' });
  });

  test('Enrolltes Linux (os aus `uname -s` = "Linux") wird case-insensitiv als Linux erkannt', async () => {
    const { svc, calls } = build({ node: { ...WIN_NODE, os: 'Linux' } });
    await svc.updateNode('n1', OK_OPTS);
    expect(calls[0]).toMatchObject({ scriptId: 'update-wazuh-agent', user: 'root' });
  });

  test('Node ohne IP → E_NO_HOST', async () => {
    const { svc } = build({ node: { ...WIN_NODE, ip: null } });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_NO_HOST' });
  });

  test('Happy Path: Runner bekommt Host AUS DER REGISTRY + festen Update-scriptId → ok + ran-Audit', async () => {
    const { svc, audits, calls } = build();
    const res = await svc.updateNode('n1', { ...OK_OPTS, agentVersion: '4.14.6' });
    expect(res).toMatchObject({ ok: true, nodeId: 'n1', host: '10.0.10.50' });
    expect(calls[0]).toMatchObject({ host: '10.0.10.50', scriptId: UPDATE_SCRIPT_ID, env: { WAZUH_AGENT_VERSION: '4.14.6' } });
    expect(audits.some((a) => a.type === 'node.update.ran')).toBe(true);
  });

  test('Runner nonzero → E_UPDATE_FAILED + failed-Audit (kein Roh-Detail)', async () => {
    const { svc, audits } = build({ runner: async () => ({ code: 1, stderr: 'C:\\secret\\path failed' }) });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_UPDATE_FAILED' });
    expect(audits.some((a) => a.type === 'node.update.failed')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('secret');
  });

  test('Runner wirft → E_SSH', async () => {
    const { svc } = build({ runner: async () => { throw new Error('connect ECONNREFUSED key=/root/.ssh/id'); } });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_SSH' });
  });

  test('Timeout → E_TIMEOUT', async () => {
    const { svc } = build({ runner: async () => ({ code: null, timedOut: true }) });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_TIMEOUT' });
  });

  test('Default-RunnerFactory (nicht injiziert) → fail-safe E_NO_CHANNEL (erst NACH Gates)', async () => {
    const audits = [];
    const svc = new NodeUpdateService({
      provisioningRepo: { getNode: async () => WIN_NODE },
      authService: { verifyDeployReauth: async () => ({ ok: true }) },
      isUpdateEnabled: () => true,
      audit: async (t, d) => { audits.push({ t, d }); },
    });
    await expect(svc.updateNode('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_NO_CHANNEL' });
  });
});

describe('NodeUpdateService.captureHostKey — Option 2 (Arm-Confirm, Host-Key erfassen+pinnen)', () => {
  const PIN = 'e'.repeat(64);

  test('admin + reauth + Scanner → Pin gespeichert (updateNode), captured-Audit, Fingerprint zurück', async () => {
    const { svc, audits, updates } = build({ hostKeyScanner: async ({ host }) => (host === '10.0.10.50' ? PIN : null) });
    const res = await svc.captureHostKey('n1', OK_OPTS);
    expect(res).toMatchObject({ nodeId: 'n1', host: '10.0.10.50', fingerprint: PIN });
    expect(updates[0]).toMatchObject({ id: 'n1', patch: { hostKeyPin: PIN } });
    expect(audits.some((a) => a.type === 'node.hostkey.captured')).toBe(true);
  });

  test('Reauth fehlgeschlagen → E_REAUTH, Scanner NICHT gerufen, denied-Audit (fail-closed)', async () => {
    let scanned = 0;
    const { svc, audits } = build({ reauthOk: false, hostKeyScanner: async () => { scanned += 1; return PIN; } });
    await expect(svc.captureHostKey('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_REAUTH' });
    expect(scanned).toBe(0);
    expect(audits.some((a) => a.type === 'node.hostkey.denied')).toBe(true);
  });

  test('unbekannter Node → E_NOT_FOUND; Node ohne IP → E_NO_HOST', async () => {
    const s1 = build({ hostKeyScanner: async () => PIN });
    await expect(s1.svc.captureHostKey('nope', OK_OPTS)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    const s2 = build({ node: { ...WIN_NODE, ip: null }, hostKeyScanner: async () => PIN });
    await expect(s2.svc.captureHostKey('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_NO_HOST' });
  });

  test('Scan scheitert → E_SCAN + failed-Audit (kein Pin gespeichert)', async () => {
    const { svc, audits, updates } = build({ hostKeyScanner: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(svc.captureHostKey('n1', OK_OPTS)).rejects.toMatchObject({ code: 'E_SCAN' });
    expect(updates).toHaveLength(0);
    expect(audits.some((a) => a.type === 'node.hostkey.failed')).toBe(true);
  });
});
