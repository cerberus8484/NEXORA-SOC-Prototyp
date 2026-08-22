'use strict';

// Reine Preflight-Statusberechnung fürs Deployment Center „Systemstatus"-Panel.
// Kein I/O — der Aufrufer reicht die rohen Fakten hinein (env-Boden, DB-armed,
// Boot-Bedingungen), diese Funktion leitet den anzeigbaren Zustand + Checks ab.
//
// Zwei-Schlüssel: EFFEKTIV scharf nur, wenn der env-Boden (Kommissionierung) UND
// der DB-Arm-Toggle (Betrieb) beide an sind. Fehlt eine Boot-Bedingung, ist Armen
// gar nicht erst möglich (die API würde bei env=true nicht booten).

const { computeDeployPreflight } = require('../../src/deploy/deployPreflight');

const facts = (over = {}) => ({
  floorEnabled: true, armed: true,
  hypervisorAllowlistSet: true, encKeyDedicated: true, ...over,
});

describe('computeDeployPreflight — Zwei-Schlüssel-Zustand', () => {
  test('beide Schlüssel + Bedingungen → effektiv scharf', () => {
    const r = computeDeployPreflight(facts());
    expect(r.effectiveEnabled).toBe(true);
    expect(r.state).toBe('armed');
    expect(r.blockers).toHaveLength(0);
  });

  test('env-Boden aus → inert, Armen unmöglich (Kommissionierung fehlt)', () => {
    const r = computeDeployPreflight(facts({ floorEnabled: false }));
    expect(r.effectiveEnabled).toBe(false);
    expect(r.state).toBe('not_commissioned');
    expect(r.canArm).toBe(false);
  });

  test('Boden an, aber nicht armed → inert, aber Armen ist möglich', () => {
    const r = computeDeployPreflight(facts({ armed: false }));
    expect(r.effectiveEnabled).toBe(false);
    expect(r.state).toBe('disarmed');
    expect(r.canArm).toBe(true);
  });

  test('Boden an, aber Enc-Key nicht dediziert → Armen blockiert (Boot-Bedingung)', () => {
    const r = computeDeployPreflight(facts({ armed: false, encKeyDedicated: false }));
    expect(r.canArm).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/SETTINGS_ENC_KEY/i);
  });

  test('Boden an, aber Hypervisor-Allowlist leer → Armen blockiert', () => {
    const r = computeDeployPreflight(facts({ armed: false, hypervisorAllowlistSet: false }));
    expect(r.canArm).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/allowlist/i);
  });

  test('Checks werden strukturiert ausgewiesen (fürs Panel, grün/rot)', () => {
    const r = computeDeployPreflight(facts({ armed: false, encKeyDedicated: false }));
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.ok]));
    expect(byId.floor).toBe(true);
    expect(byId.hypervisorAllowlist).toBe(true);
    expect(byId.encKey).toBe(false);
  });

  test('robust gegen fehlenden Kontext (fail-closed)', () => {
    const r = computeDeployPreflight(undefined);
    expect(r.effectiveEnabled).toBe(false);
    expect(r.canArm).toBe(false);
  });
});
