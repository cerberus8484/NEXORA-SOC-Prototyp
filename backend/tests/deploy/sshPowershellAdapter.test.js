'use strict';

// Control-Adapter ssh-powershell (Windows-Client / Wazuh-Agent per MSI). Sicherheitskritisch:
// getestet mit INJIZIERTEM Fake-Runner (kein echter SSH-Transport) — Erfolg, Fehlschlag,
// Timeout, Injektions-Ablehnung, Windows-User erlaubt, sichere ENV, kein Secret-/Roh-Leak.

const { installWindowsAgent, validateParams, DeployAdapterError } = require('../../src/deploy/adapters/sshPowershellAdapter');

const okRunner = (calls) => async (opts) => { calls.push(opts); return { code: 0, stdout: 'ok' }; };

describe('sshPowershellAdapter.validateParams — Eingabe-Härtung', () => {
  test('gültige Eingabe: Defaults sshUser=Administrator, sshPort=22, agentName=targetHost', () => {
    const v = validateParams({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77' });
    expect(v).toEqual({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77', sshUser: 'Administrator', sshPort: 22, agentName: '10.0.20.50' });
  });

  test('Windows-Konten (Administrator, nexora-svc) werden akzeptiert', () => {
    expect(validateParams({ targetHost: 'h', wazuhManager: 'm', sshUser: 'Administrator' }).sshUser).toBe('Administrator');
    expect(validateParams({ targetHost: 'h', wazuhManager: 'm', sshUser: 'nexora-svc' }).sshUser).toBe('nexora-svc');
  });

  test('Injektion in targetHost / sshUser / Port wird abgelehnt', () => {
    expect(() => validateParams({ targetHost: '10.0.20.50; rm', wazuhManager: 'm' })).toThrow(DeployAdapterError);
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', sshUser: 'ad min' })).toThrow(DeployAdapterError);
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', sshUser: 'a;b' })).toThrow(DeployAdapterError);
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', sshPort: 70000 })).toThrow(DeployAdapterError);
  });
});

describe('sshPowershellAdapter.installWindowsAgent — Ausführung über injizierten Runner', () => {
  test('Erfolg (Exit 0) → ok:true, installed:true', async () => {
    const calls = [];
    const res = await installWindowsAgent({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77', agentName: 'win01' }, { runner: okRunner(calls) });
    expect(res).toMatchObject({ ok: true, installed: true, host: '10.0.20.50', agentName: 'win01' });
  });

  test('übergibt dem Runner sichere ENV + festen Windows-scriptId, KEINE Shell-Command', async () => {
    const calls = [];
    await installWindowsAgent({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77', sshUser: 'Administrator' }, { runner: okRunner(calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      host: '10.0.20.50', user: 'Administrator', port: 22, scriptId: 'install-wazuh-agent-windows',
      env: { WAZUH_MANAGER: '10.0.10.77', WAZUH_AGENT_NAME: '10.0.20.50' },
    });
    expect(calls[0]).not.toHaveProperty('command');
    expect(calls[0]).not.toHaveProperty('cmd');
  });

  test('Non-Zero-Exit → fail-closed (install_failed), keine rohen Details', async () => {
    const runner = async () => ({ code: 1, stderr: 'msiexec 1603 C:\\secret\\path' });
    const res = await installWindowsAgent({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'install_failed' });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  test('Runner wirft (SSH-Fehler) → ssh_error, kein Leak', async () => {
    const runner = async () => { throw new Error('connect ECONNREFUSED 10.0.20.50:22 key=C:/keys/id'); };
    const res = await installWindowsAgent({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'ssh_error' });
    expect(JSON.stringify(res)).not.toContain('ECONNREFUSED');
  });

  test('Timeout → reason timeout', async () => {
    const runner = async () => ({ code: null, timedOut: true });
    const res = await installWindowsAgent({ targetHost: '10.0.20.50', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'timeout' });
  });

  test('fehlender Runner → wirft (kein stiller No-op)', async () => {
    await expect(installWindowsAgent({ targetHost: 'h', wazuhManager: 'm' }, {})).rejects.toThrow(DeployAdapterError);
  });

  test('Injektion im targetHost → wirft VOR dem Runner-Aufruf', async () => {
    const calls = [];
    await expect(installWindowsAgent({ targetHost: 'h; id', wazuhManager: 'm' }, { runner: okRunner(calls) })).rejects.toThrow(DeployAdapterError);
    expect(calls).toHaveLength(0);
  });
});
