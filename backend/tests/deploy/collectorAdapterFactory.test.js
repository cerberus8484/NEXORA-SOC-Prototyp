'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Phase 3, Slice 4: Kollektor-Adapter verallgemeinert.
//
// firewall-collector und siem-collector haben DIESELBE Form: ein Nexora-Binary,
// per Release-Artefakt verteilt, Integritaet ueber SHA256, Ziel ist der Intake.
// Sie unterscheiden sich nur im Skript (und damit im Dienst-/Dateinamen).
//
// Statt den Adapter zu kopieren, gibt es eine Fabrik: gleiche Validierung, gleiche
// Leak-Regeln, gleiche Fehlerbehandlung — ein neuer Kollektor ist damit ein
// Einzeiler plus Installer, kein zweiter Adapter mit eigener (driftender) Logik.
// ─────────────────────────────────────────────────────────────────────────

const {
  makeCollectorInstaller, installFirewallCollector, installSiemCollector,
} = require('../../src/deploy/adapters/firewallCollectorAdapter');
const { getModule } = require('../../src/deploy/deployModuleCatalog');

const SHA = 'b'.repeat(64);
const base = (over = {}) => ({
  targetHost: '10.0.10.90', sshUser: 'deploy', sshPort: 22,
  collectorVersion: 'v2.0.1', checksumSha256: SHA,
  intakeUrl: 'https://10.0.10.75/api/v1/dataplane/events', ...over,
});
const okRunner = () => { const calls = []; return { calls, fn: async (a) => { calls.push(a); return { code: 0 }; } }; };

describe('makeCollectorInstaller — Fabrik', () => {
  test('erzeugt einen Installer, der den uebergebenen scriptId nutzt', async () => {
    const r = okRunner();
    const install = makeCollectorInstaller({ scriptId: 'install-irgendein-collector' });

    await install(base(), { runner: r.fn });

    expect(r.calls[0].scriptId).toBe('install-irgendein-collector');
  });

  test('verlangt einen scriptId (kein Adapter ohne Allowlist-Key)', () => {
    expect(() => makeCollectorInstaller({})).toThrow();
    expect(() => makeCollectorInstaller({ scriptId: '' })).toThrow();
  });

  test('erbt die Validierung — Injektion wird abgelehnt, Runner nie gerufen', async () => {
    const r = okRunner();
    const install = makeCollectorInstaller({ scriptId: 'x' });

    await expect(install(base({ targetHost: 'a; rm -rf /' }), { runner: r.fn })).rejects.toThrow();
    await expect(install(base({ checksumSha256: 'kurz' }), { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);
  });

  test('erbt den Credential-Kanal (injiziert, nie im Ergebnis)', async () => {
    const r = okRunner();
    const install = makeCollectorInstaller({ scriptId: 'x' });

    await install(base(), { runner: r.fn, collectorToken: 'tok-abcdefgh' });
    expect(r.calls[0].env.NEXORA_COLLECTOR_TOKEN).toBe('tok-abcdefgh');
  });
});

describe('siem-collector — zweiter Kollektor ueber dieselbe Fabrik', () => {
  test('nutzt den eigenen Allowlist-scriptId', async () => {
    const r = okRunner();
    const res = await installSiemCollector(base(), { runner: r.fn });

    expect(res.ok).toBe(true);
    expect(r.calls[0].scriptId).toBe('install-siem-collector');
  });

  test('Katalog-Eintrag vorhanden und als agent-install registriert', () => {
    const m = getModule('siem-collector');

    expect(m.kind).toBe('agent-install');
    expect(m.controlAdapter).toBe('ssh-siem-collector');
    expect(m.paramSchema.checksumSha256.required).toBe(true);
    expect(m.paramSchema.intakeUrl.required).toBe(true);
  });

  test('kein Secret im Schema (assertNoSecrets wuerde es ohnehin ablehnen)', () => {
    const keys = Object.keys(getModule('siem-collector').paramSchema).join(',');
    expect(keys).not.toMatch(/token|secret|password/i);
  });
});

describe('firewall-collector bleibt unveraendert (keine Regression durch die Fabrik)', () => {
  test('nutzt weiterhin seinen eigenen scriptId', async () => {
    const r = okRunner();
    await installFirewallCollector(base(), { runner: r.fn });

    expect(r.calls[0].scriptId).toBe('install-firewall-collector');
  });
});
