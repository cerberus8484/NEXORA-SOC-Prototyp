'use strict';

// Windows-Server Config-Applier (Slice 2). Sicherheitskritisch: der Renderer erzeugt
// Code, der als SYSTEM läuft → geprüft wird strikte Validierung/Escaping, Secret-Freiheit,
// static/DHCP, optionaler Wazuh-Block, fail-safe Default-Deliver und Retry-Verhalten.

const { renderWindowsUserData } = require('../../src/deploy/appliers/windowsServerConfigRenderer');
const { buildWindowsServerConfigMedia } = require('../../src/deploy/appliers/windowsServerConfigMedia');
const {
  makeWindowsServerConfigApplier, windowsServerConfigApplier, computeConfigHash,
} = require('../../src/deploy/appliers/windowsServerConfigApplier');

const staticParams = (o = {}) => ({
  hostname: 'win01', ipMode: 'static', staticIp: '10.0.10.50', cidr: 24,
  gateway: '10.0.10.254', dns: ['10.0.10.10', '10.0.10.11'], ...o,
});

describe('windowsServerConfigRenderer — Cloudbase-Init User-Data', () => {
  test('static: Header + Hostname + statische IP/Gateway/DNS + OpenSSH', () => {
    const s = renderWindowsUserData(staticParams());
    expect(s.startsWith('#ps1_sysnative')).toBe(true);
    expect(s).toMatch(/Rename-Computer -NewName 'win01'/);
    expect(s).toMatch(/New-NetIPAddress .*-IPAddress '10\.0\.10\.50' -PrefixLength 24 -DefaultGateway '10\.0\.10\.254'/);
    expect(s).toMatch(/Set-DnsClientServerAddress .*@\('10\.0\.10\.10', '10\.0\.10\.11'\)/);
    expect(s).toMatch(/OpenSSH\.Server/);
  });

  test('dhcp: DHCP aktivieren, KEINE statische IP', () => {
    const s = renderWindowsUserData(staticParams({ ipMode: 'dhcp' }));
    expect(s).toMatch(/Set-NetIPInterface .*-Dhcp Enabled/);
    expect(s).not.toMatch(/New-NetIPAddress/);
  });

  test('Wazuh-Block nur bei gesetztem wazuhManager (Manager/Name aus Params)', () => {
    expect(renderWindowsUserData(staticParams())).not.toMatch(/WAZUH_MANAGER/);
    const s = renderWindowsUserData(staticParams({ wazuhManager: '10.0.10.77', agentName: 'win-srv' }));
    expect(s).toMatch(/\$env:WAZUH_MANAGER = '10\.0\.10\.77'/);
    expect(s).toMatch(/\$env:WAZUH_AGENT_NAME = 'win-srv'/);
    expect(s).toMatch(/install-wazuh-agent\.ps1/);
  });

  test('agentName default = hostname, wenn nicht gesetzt', () => {
    const s = renderWindowsUserData(staticParams({ wazuhManager: '10.0.10.77' }));
    expect(s).toMatch(/\$env:WAZUH_AGENT_NAME = 'win01'/);
  });

  test('Injektion in jedem Feld wird HART abgelehnt (Defense-in-Depth, RCE-Schutz)', () => {
    expect(() => renderWindowsUserData(staticParams({ hostname: "win01'; rm" }))).toThrow(/hostname/);
    expect(() => renderWindowsUserData(staticParams({ staticIp: '10.0.0.1; calc' }))).toThrow(/staticIp/);
    expect(() => renderWindowsUserData(staticParams({ gateway: 'nope' }))).toThrow(/gateway/);
    expect(() => renderWindowsUserData(staticParams({ cidr: 99 }))).toThrow(/cidr/);
    expect(() => renderWindowsUserData(staticParams({ dns: ['1.1.1.1', 'bad'] }))).toThrow(/dns/);
    expect(() => renderWindowsUserData(staticParams({ wazuhManager: 'm`whoami`' }))).toThrow(/wazuhManager/);
  });

  test('rendert NIE ein Secret (unbekannte/secret-Felder werden ignoriert)', () => {
    const s = renderWindowsUserData(staticParams({ adminPassword: 'geheim!', apiKey: 'x' }));
    expect(s).not.toMatch(/geheim|adminPassword|apiKey/);
  });

  test('deployPublicKey → authorized_keys-Block (streng validiert, single-quoted, ACLs); ungültig abgelehnt', () => {
    const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc123 nexora-deploy';
    const s = renderWindowsUserData(staticParams(), { deployPublicKey: PUB });
    expect(s).toMatch(/administrators_authorized_keys/);
    expect(s).toContain(`Add-Content -Path $akFile -Value '${PUB}'`);
    expect(s).toMatch(/icacls .*Administrators:F/);
    // Injektionsversuch (kein gültiger OpenSSH-Key) → hart abgelehnt.
    expect(() => renderWindowsUserData(staticParams(), { deployPublicKey: "ssh-ed25519 x'; rm -rf /" })).toThrow(/deployPublicKey/);
  });

  test('ohne deployPublicKey → kein authorized_keys-Block', () => {
    expect(renderWindowsUserData(staticParams())).not.toMatch(/authorized_keys/);
  });
});

describe('windowsServerConfigMedia — Verpackung', () => {
  test('baut Artefakt mit filename/guestPath/label/content', () => {
    const m = buildWindowsServerConfigMedia({ content: '#ps1_sysnative\n', configHash: 'abcdef0123456789' });
    expect(m).toMatchObject({ guestPath: '/openstack/latest/user_data', label: 'config-2', content: '#ps1_sysnative\n' });
    expect(m.filename).toMatch(/^windows-userdata-abcdef012345\.ps1$/);
  });
  test('leerer content / fehlender configHash → Fehler', () => {
    expect(() => buildWindowsServerConfigMedia({ content: '  ', configHash: 'x' })).toThrow(/content/);
    expect(() => buildWindowsServerConfigMedia({ content: 'x' })).toThrow(/configHash/);
  });
});

describe('windowsServerConfigApplier — Ablauf + fail-safe', () => {
  test('rendert + reicht content/configHash/params an deliver', async () => {
    const calls = [];
    const applier = makeWindowsServerConfigApplier({ deliver: async (a) => { calls.push(a); return { applied: true }; } });
    const res = await applier({ id: 'conn' }, 123, staticParams());
    expect(res).toMatchObject({ applied: true });
    expect(calls[0].vmid).toBe(123);
    expect(calls[0].content).toMatch(/^#ps1_sysnative/);
    expect(typeof calls[0].configHash).toBe('string');
  });

  test('provisioniert den Deploy-Public-Key (injizierter Resolver) in den Content', async () => {
    const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIxyz nexora-deploy';
    const calls = [];
    const applier = makeWindowsServerConfigApplier({ deliver: async (a) => { calls.push(a); return { applied: true }; }, deployPublicKeyResolver: async () => PUB });
    await applier({ id: 'c' }, 1, staticParams());
    expect(calls[0].content).toMatch(/administrators_authorized_keys/);
    expect(calls[0].content).toContain(PUB);
  });

  test('ohne Keypair (Resolver null / wirft) → kein authorized_keys (best-effort, kein Kippen)', async () => {
    const calls = [];
    const a1 = makeWindowsServerConfigApplier({ deliver: async (a) => { calls.push(a); return {}; }, deployPublicKeyResolver: async () => null });
    await a1({ id: 'c' }, 1, staticParams());
    expect(calls[0].content).not.toMatch(/authorized_keys/);
    const calls2 = [];
    const a2 = makeWindowsServerConfigApplier({ deliver: async (a) => { calls2.push(a); return {}; }, deployPublicKeyResolver: async () => { throw new Error('settings down'); } });
    await a2({ id: 'c' }, 1, staticParams());
    expect(calls2[0].content).not.toMatch(/authorized_keys/);
  });

  test('computeConfigHash ist idempotent + strippt Secrets (Hash unabhängig von Secret-Key)', () => {
    const a = computeConfigHash(staticParams());
    const b = computeConfigHash(staticParams());
    const c = computeConfigHash(staticParams({ adminPassword: 'geheim!' }));
    expect(a).toBe(b);
    expect(a).toBe(c); // stripSecrets → Secret beeinflusst den Hash nicht
  });

  test('Default-Applier ist FAIL-SAFE: wirft (kein Gast-Zustellkanal) → Rollback', async () => {
    await expect(windowsServerConfigApplier({ id: 'conn' }, 1, staticParams())).rejects.toThrow(/nicht konfiguriert|Config-Drive/);
  });

  test('retryable-Fehler wird wiederholt, non-retryable sofort geworfen', async () => {
    let n = 0;
    const flaky = makeWindowsServerConfigApplier({
      maxAttempts: 3, delayMs: 1,
      deliver: async () => { n += 1; if (n < 3) { const e = new Error('guest not ready'); e.retryable = true; throw e; } return { applied: true }; },
    });
    await expect(flaky({ id: 'c' }, 1, staticParams())).resolves.toMatchObject({ applied: true });
    expect(n).toBe(3);

    const hard = makeWindowsServerConfigApplier({ maxAttempts: 5, delayMs: 1, deliver: async () => { const e = new Error('fatal'); e.retryable = false; throw e; } });
    await expect(hard({ id: 'c' }, 1, staticParams())).rejects.toThrow(/fatal/);
  });
});
