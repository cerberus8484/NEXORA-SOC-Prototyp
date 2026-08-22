'use strict';

// Control-Adapter ssh-systemd (Linux-Client / Wazuh-Agent-Install). Sicherheitskritisch:
// getestet wird mit einem INJIZIERTEN Fake-Runner (kein echter SSH-Transport) — Erfolg,
// Fehlschlag, Timeout, Injektions-Ablehnung, sichere ENV-Übergabe, kein Secret-/Roh-Leak.

const { installLinuxAgent, validateParams, DeployAdapterError } = require('../../src/deploy/adapters/sshSystemdAdapter');

const okRunner = (calls) => async (opts) => { calls.push(opts); return { code: 0, stdout: 'ok' }; };

describe('sshSystemdAdapter.validateParams — Eingabe-Härtung (Defense-in-Depth)', () => {
  test('gültige Eingabe: Defaults sshUser=root, sshPort=22, agentName=targetHost, os=debian', () => {
    const v = validateParams({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' });
    expect(v).toEqual({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', sshUser: 'root', sshPort: 22, agentName: '10.0.10.90', os: 'debian' });
  });

  test('os: gültige Distro akzeptiert (case-insensitiv normalisiert), unbekanntes/injiziertes os abgelehnt', () => {
    expect(validateParams({ targetHost: 'h', wazuhManager: 'm', os: 'rocky' }).os).toBe('rocky');
    expect(validateParams({ targetHost: 'h', wazuhManager: 'm', os: 'SLES' }).os).toBe('sles');
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', os: 'windows' })).toThrow(DeployAdapterError);
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', os: 'debian; rm -rf /' })).toThrow(DeployAdapterError);
  });

  test('Injektion im targetHost wird abgelehnt', () => {
    expect(() => validateParams({ targetHost: '10.0.10.90; rm -rf /', wazuhManager: '10.0.10.77' })).toThrow(DeployAdapterError);
  });

  test('Injektion im wazuhManager wird abgelehnt', () => {
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm`whoami`' })).toThrow(DeployAdapterError);
  });

  test('ungültiger sshUser / sshPort wird abgelehnt', () => {
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', sshUser: 'ro ot' })).toThrow(DeployAdapterError);
    expect(() => validateParams({ targetHost: 'h', wazuhManager: 'm', sshPort: 70000 })).toThrow(DeployAdapterError);
  });
});

describe('sshSystemdAdapter.installLinuxAgent — Ausführung über injizierten Runner', () => {
  test('Erfolg (Exit 0) → ok:true, installed:true', async () => {
    const calls = [];
    const res = await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', agentName: 'web01' }, { runner: okRunner(calls) });
    expect(res).toMatchObject({ ok: true, installed: true, host: '10.0.10.90', agentName: 'web01' });
  });

  test('übergibt dem Runner sichere ENV (WAZUH_MANAGER/-AGENT_NAME) + festen scriptId, KEINE Shell-Command', async () => {
    const calls = [];
    await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }, { runner: okRunner(calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      host: '10.0.10.90', user: 'root', port: 22, scriptId: 'install-wazuh-agent',
      env: { WAZUH_MANAGER: '10.0.10.77', WAZUH_AGENT_NAME: '10.0.10.90' },
    });
    // Der Runner bekommt NIE eine fertige Command-Zeile aus Nutzereingabe.
    expect(calls[0]).not.toHaveProperty('command');
    expect(calls[0]).not.toHaveProperty('cmd');
  });

  test('reicht das gewählte os als WAZUH_AGENT_OS an den Runner (Default debian)', async () => {
    const rocky = [];
    await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', os: 'rocky' }, { runner: okRunner(rocky) });
    expect(rocky[0].env.WAZUH_AGENT_OS).toBe('rocky');
    const deflt = [];
    await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }, { runner: okRunner(deflt) });
    expect(deflt[0].env.WAZUH_AGENT_OS).toBe('debian');
  });

  test('Non-Zero-Exit → fail-closed (ok:false, reason install_failed), keine rohen Details', async () => {
    const runner = async () => ({ code: 1, stderr: 'E: internal apt path /opt/secret failed' });
    const res = await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'install_failed' });
    expect(JSON.stringify(res)).not.toContain('/opt/secret'); // roher stderr nie zurück
  });

  test('Runner wirft (SSH-Fehler) → ok:false reason ssh_error, kein Leak des rohen Fehlers', async () => {
    const runner = async () => { throw new Error('connect ECONNREFUSED 10.0.10.90:22 key=/root/.ssh/id_ed25519'); };
    const res = await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'ssh_error' });
    const dump = JSON.stringify(res);
    expect(dump).not.toContain('ECONNREFUSED');
    expect(dump).not.toContain('id_ed25519');
  });

  test('Timeout (runner meldet timedOut) → ok:false reason timeout', async () => {
    const runner = async () => ({ code: null, timedOut: true });
    const res = await installLinuxAgent({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' }, { runner });
    expect(res).toMatchObject({ ok: false, installed: false, reason: 'timeout' });
  });

  test('fehlender Runner → wirft (kein stiller No-op)', async () => {
    await expect(installLinuxAgent({ targetHost: 'h', wazuhManager: 'm' }, {})).rejects.toThrow(DeployAdapterError);
  });

  test('Injektion im targetHost → wirft VOR dem Runner-Aufruf (Runner nie gerufen)', async () => {
    const calls = [];
    await expect(installLinuxAgent({ targetHost: 'h; id', wazuhManager: 'm' }, { runner: okRunner(calls) })).rejects.toThrow(DeployAdapterError);
    expect(calls).toHaveLength(0);
  });
});
