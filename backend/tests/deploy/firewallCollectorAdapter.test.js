'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Phase 3, Slice 1: Firewall-Collector als agent-install-Modul.
//
// Der Collector liegt als Go-Binary im PRIVATEN Data-Plane-Repo. Verteilt wird er
// deshalb als Release-Artefakt (User-Entscheidung: gleiches Repo, GitHub-Releases)
// — der Installer zieht es über Version + SHA256 und prüft die Prüfsumme, BEVOR
// etwas ausgeführt wird. Damit gilt für den eigenen Collector derselbe Maßstab wie
// beim Wazuh-Installer (GPG-Fingerprint / MSI-Authenticode): niemals ungeprüften
// Code ausführen.
//
// Wiederverwendet die bestehende, security-reviewte Kette: ssh2-Transport mit
// Host-Key-Pinning, verschlüsselter Connector, Vier-Augen + Reauth, Gates.
// Neu ist nur Adapter + Installer + Katalogeintrag.
// ─────────────────────────────────────────────────────────────────────────

const { installFirewallCollector } = require('../../src/deploy/adapters/firewallCollectorAdapter');
const { getModule } = require('../../src/deploy/deployModuleCatalog');

const SHA = 'a'.repeat(64);
const base = (over = {}) => ({
  targetHost: '10.0.10.90', sshUser: 'deploy', sshPort: 22,
  collectorVersion: 'v1.2.0', checksumSha256: SHA,
  intakeUrl: 'https://10.0.10.75/api/v1/dataplane/events', ...over,
});

const okRunner = () => { const calls = []; return { calls, fn: async (a) => { calls.push(a); return { code: 0 }; } }; };

describe('Firewall-Collector-Adapter — Parameter (fail-fast, injektionssicher)', () => {
  test('gültige Parameter → Runner wird mit dem Allowlist-scriptId gerufen', async () => {
    const r = okRunner();
    const res = await installFirewallCollector(base(), { runner: r.fn });

    expect(res.ok).toBe(true);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].scriptId).toBe('install-firewall-collector');
    expect(r.calls[0].host).toBe('10.0.10.90');
    expect(r.calls[0].user).toBe('deploy');
  });

  test('Version, Prüfsumme und Intake-URL gehen als ENV — nie in eine Befehlszeile', async () => {
    const r = okRunner();
    await installFirewallCollector(base(), { runner: r.fn });

    const env = r.calls[0].env;
    expect(env.COLLECTOR_VERSION).toBe('v1.2.0');
    expect(env.COLLECTOR_SHA256).toBe(SHA);
    expect(env.NEXORA_INTAKE_URL).toBe('https://10.0.10.75/api/v1/dataplane/events');
    // Der Runner bekommt KEIN freies Kommando — nur den Allowlist-Key.
    expect(r.calls[0]).not.toHaveProperty('command');
  });

  test.each([
    ['targetHost mit Semikolon', { targetHost: '10.0.10.90; rm -rf /' }],
    ['targetHost leer',          { targetHost: '' }],
    ['sshUser mit Backtick',     { sshUser: 'de`ploy`' }],
    ['sshPort ungültig',         { sshPort: 0 }],
    ['Version mit Shell-Zeichen',{ collectorVersion: 'v1.0 && curl evil' }],
    ['Prüfsumme zu kurz',        { checksumSha256: 'abc' }],
    ['Prüfsumme nicht hex',      { checksumSha256: 'z'.repeat(64) }],
    ['Intake-URL kein http(s)',  { intakeUrl: 'file:///etc/passwd' }],
    ['Intake-URL mit Leerzeichen', { intakeUrl: 'https://x /y' }],
  ])('lehnt %s ab — VOR jedem Runner-Aufruf', async (_name, over) => {
    const r = okRunner();
    await expect(installFirewallCollector(base(over), { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);          // nichts wurde ausgeführt
  });

  test('ohne Runner: fail-closed (kein stiller Erfolg)', async () => {
    await expect(installFirewallCollector(base(), {})).rejects.toThrow();
  });

  test('Prüfsumme ist PFLICHT — ohne sie wird nicht installiert', async () => {
    const r = okRunner();
    const p = base(); delete p.checksumSha256;
    await expect(installFirewallCollector(p, { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);
  });
});

describe('Firewall-Collector-Adapter — Ergebnis & Fehlerbehandlung', () => {
  test('Exit-Code ≠ 0 → ok:false mit Grund, KEIN roher Output im Ergebnis', async () => {
    const runner = async () => ({ code: 3, stderr: 'geheimes Token abc123 im Fehlertext' });
    const res = await installFirewallCollector(base(), { runner });

    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(JSON.stringify(res)).not.toContain('abc123');   // nichts Rohes nach außen
  });

  test('Timeout wird als solcher gemeldet', async () => {
    const runner = async () => ({ code: null, timedOut: true });
    const res = await installFirewallCollector(base(), { runner });

    expect(res.ok).toBe(false);
    expect(String(res.reason)).toMatch(/timeout|Zeit/i);
  });
});

describe('Katalog-Eintrag', () => {
  test('Modul firewall-collector ist als agent-install registriert', () => {
    const m = getModule('firewall-collector');

    expect(m.kind).toBe('agent-install');
    expect(m.controlAdapter).toBe('ssh-firewall-collector');
    expect(m.targetKind).toBe('existing-host');
  });

  test('paramSchema verlangt Version, Prüfsumme und Intake-URL', () => {
    const s = getModule('firewall-collector').paramSchema;

    expect(s.collectorVersion.required).toBe(true);
    expect(s.checksumSha256.required).toBe(true);
    expect(s.intakeUrl.required).toBe(true);
    // Kein Secret im Spec — DeploySpec.assertNoSecrets würde es ohnehin ablehnen.
    expect(Object.keys(s).join(',')).not.toMatch(/token|secret|password/i);
  });
});

// ── Credential-Kanal (Slice 2) ───────────────────────────────────────────────
// Der Collector braucht ein Token, um Events an den Nexora-Intake zu senden.
// Es darf NICHT in den Spec-Params stehen (DeploySpec.assertNoSecrets verbietet
// das zu Recht) — es wird zur Apply-Zeit INJIZIERT, wie der SSH-Runner. Damit
// taucht es weder im Spec noch im Audit noch im Plan auf.
describe('Firewall-Collector-Adapter — Credential (injiziert, nie im Spec)', () => {
  const TOKEN = 'geheimes-collector-token-xyz';

  test('injiziertes Token geht als ENV an den Installer', async () => {
    const r = okRunner();
    await installFirewallCollector(base(), { runner: r.fn, collectorToken: TOKEN });

    expect(r.calls[0].env.NEXORA_COLLECTOR_TOKEN).toBe(TOKEN);
  });

  test('ohne Token laeuft es weiter (Installer laesst das Feld dann leer)', async () => {
    const r = okRunner();
    const res = await installFirewallCollector(base(), { runner: r.fn });

    expect(res.ok).toBe(true);
    expect(r.calls[0].env).not.toHaveProperty('NEXORA_COLLECTOR_TOKEN');
  });

  test('Token erscheint NIE im Ergebnis — auch nicht im Fehlerfall', async () => {
    const failing = async () => ({ code: 7, stderr: `Fehler mit ${TOKEN} im Text` });
    const res = await installFirewallCollector(base(), { runner: failing, collectorToken: TOKEN });

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });

  test('Token wird nicht aus den PARAMS uebernommen (nur injiziert)', async () => {
    const r = okRunner();
    // Selbst wenn jemand es faelschlich in die Params schreibt: es darf nicht durchrutschen.
    await installFirewallCollector(base({ collectorToken: 'aus-params', token: 'auch-nicht' }), { runner: r.fn });

    const env = JSON.stringify(r.calls[0].env);
    expect(env).not.toContain('aus-params');
    expect(env).not.toContain('auch-nicht');
  });
});

// ── Bezugsquelle frei waehlbar (Slice 3) ─────────────────────────────────────
// Ein Deploy darf NICHT daran haengen, dass jemand ein GitHub-Release hochlaedt.
// Die Integritaet haengt an der PRUEFSUMME, nicht an der Quelle — also darf die
// Quelle konfigurierbar sein: interner Webserver, Spiegel, Air-Gap-Share.
// Default bleibt das Release im Control-Plane-Repo (rueckwaertskompatibel).
describe('Firewall-Collector-Adapter — Bezugsquelle (auch ohne GitHub)', () => {
  test('eigene artifactBaseUrl wird an den Installer durchgereicht', async () => {
    const r = okRunner();
    await installFirewallCollector(base({ artifactBaseUrl: 'https://10.0.10.75/artifacts' }), { runner: r.fn });

    expect(r.calls[0].env.RELEASE_BASE).toBe('https://10.0.10.75/artifacts');
  });

  test('ohne Angabe bleibt der Default (Installer entscheidet) — kein leeres ENV', async () => {
    const r = okRunner();
    await installFirewallCollector(base(), { runner: r.fn });

    expect(r.calls[0].env).not.toHaveProperty('RELEASE_BASE');
  });

  test('ungueltige Bezugsquelle wird abgelehnt — VOR dem Runner', async () => {
    const r = okRunner();
    await expect(installFirewallCollector(base({ artifactBaseUrl: 'file:///tmp' }), { runner: r.fn })).rejects.toThrow();
    await expect(installFirewallCollector(base({ artifactBaseUrl: 'https://x y' }), { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);
  });

  test('Pruefsumme bleibt Pflicht — auch bei eigener Quelle', async () => {
    const r = okRunner();
    const p = base({ artifactBaseUrl: 'https://10.0.10.75/artifacts' });
    delete p.checksumSha256;
    await expect(installFirewallCollector(p, { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);
  });
});
