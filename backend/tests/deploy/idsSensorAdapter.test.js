'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Phase 3, Slice 5: IDS-Sensor (Suricata) als agent-install-Modul.
//
// BEWUSST NICHT ueber die Kollektor-Fabrik: der IDS-Sensor hat eine ANDERE Form.
// Suricata kommt aus den Distributions-Paketquellen (GPG-gepinnt durch den
// Paketmanager), nicht als Nexora-Binary — es gibt also weder Version+SHA256 noch
// ein Release-Artefakt. Ihn in die Kollektor-Fabrik zu pressen waere eine falsche
// Abstraktion.
//
// Und er PUSHT nicht: Suricata schreibt EVE-JSON, der Collector-Hub tailt die Datei
// (SSH-tail, siehe deployment-center-concept). Deshalb auch keine intakeUrl —
// ein Feld, das nichts bewirkt, waere eine Luege im Formular.
//
// Was er braucht: das zu ueberwachende Interface und die OS-Familie (Paketmanager).
// ─────────────────────────────────────────────────────────────────────────

const { installIdsSensor } = require('../../src/deploy/adapters/idsSensorAdapter');
const { getModule } = require('../../src/deploy/deployModuleCatalog');

const base = (over = {}) => ({
  targetHost: '10.0.10.60', sshUser: 'deploy', sshPort: 22,
  monitorInterface: 'eth1', os: 'debian', ...over,
});
const okRunner = () => { const calls = []; return { calls, fn: async (a) => { calls.push(a); return { code: 0 }; } }; };

describe('IDS-Sensor-Adapter — Parameter', () => {
  test('gueltige Parameter → Runner mit Allowlist-scriptId', async () => {
    const r = okRunner();
    const res = await installIdsSensor(base(), { runner: r.fn });

    expect(res.ok).toBe(true);
    expect(r.calls[0].scriptId).toBe('install-ids-sensor');
    expect(r.calls[0].host).toBe('10.0.10.60');
  });

  test('Interface und OS gehen als ENV — nie in eine Befehlszeile', async () => {
    const r = okRunner();
    await installIdsSensor(base(), { runner: r.fn });

    expect(r.calls[0].env.MONITOR_INTERFACE).toBe('eth1');
    expect(r.calls[0].env.TARGET_OS).toBe('debian');
    expect(r.calls[0]).not.toHaveProperty('command');
  });

  test('Default-OS ist debian (rueckwaertskompatibel zum Wazuh-Muster)', async () => {
    const r = okRunner();
    const p = base(); delete p.os;
    await installIdsSensor(p, { runner: r.fn });

    expect(r.calls[0].env.TARGET_OS).toBe('debian');
  });

  test.each([
    ['Interface mit Semikolon', { monitorInterface: 'eth0; rm -rf /' }],
    ['Interface leer',          { monitorInterface: '' }],
    ['Interface mit Leerzeichen',{ monitorInterface: 'eth 0' }],
    ['OS nicht in der Allowlist',{ os: 'plan9' }],
    ['targetHost mit Backtick', { targetHost: 'a`id`' }],
    ['sshPort ungueltig',       { sshPort: 70000 }],
  ])('lehnt %s ab — VOR jedem Runner-Aufruf', async (_n, over) => {
    const r = okRunner();
    await expect(installIdsSensor(base(over), { runner: r.fn })).rejects.toThrow();
    expect(r.calls).toHaveLength(0);
  });

  test('ohne Runner: fail-closed', async () => {
    await expect(installIdsSensor(base(), {})).rejects.toThrow();
  });
});

describe('IDS-Sensor-Adapter — Ergebnis', () => {
  test('Fehlschlag ohne rohen Output nach aussen', async () => {
    const runner = async () => ({ code: 5, stderr: 'interner Pfad /root/geheim' });
    const res = await installIdsSensor(base(), { runner });

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('geheim');
  });

  test('Timeout wird benannt', async () => {
    const res = await installIdsSensor(base(), { runner: async () => ({ code: null, timedOut: true }) });
    expect(String(res.reason)).toMatch(/timeout|Zeit/i);
  });
});

describe('Katalog-Eintrag', () => {
  test('ids-sensor ist als agent-install registriert', () => {
    const m = getModule('ids-sensor');

    expect(m.kind).toBe('agent-install');
    expect(m.controlAdapter).toBe('ssh-ids-sensor');
    expect(m.targetKind).toBe('existing-host');
  });

  test('verlangt das Monitor-Interface — und KEINE intakeUrl (Sensor pusht nicht)', () => {
    const s = getModule('ids-sensor').paramSchema;

    expect(s.monitorInterface.required).toBe(true);
    expect(s.intakeUrl).toBeUndefined();       // waere ein Feld ohne Wirkung
    expect(s.checksumSha256).toBeUndefined();  // Paketquelle, kein Artefakt
  });

  test('kein Secret im Schema', () => {
    expect(Object.keys(getModule('ids-sensor').paramSchema).join(',')).not.toMatch(/token|secret|password/i);
  });
});
