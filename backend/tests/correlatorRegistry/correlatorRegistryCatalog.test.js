'use strict';

// P_CORR_ADMIN_1 — Correlator Registry Catalog (Code-Allowlist).
// Nur explizit bekannte Correlatoren sind administrierbar; unbekannt = deny.
// Kein dynamisches Laden/Ausführen von Correlator-Code. Gebundene Capabilities
// stammen ausschließlich aus dem P_CONFIG_1-Catalog (Allowlist ∩ Allowlist).

const {
  listCorrelators, getCorrelator, assertCapabilityBound,
  RISK_CLASSES, REAL_CORRELATOR_ID,
} = require('../../src/correlatorRegistry/correlatorRegistryCatalog');
const { CORRELATION_ENGINE_VERSION } = require('../../src/correlation/correlationJobDomain');

describe('CorrelatorRegistryCatalog — Allowlist (unknown = deny)', () => {
  test('listet genau die bekannten Correlatoren (mind. den realen correlation-worker)', () => {
    const all = listCorrelators();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const worker = all.find((c) => c.id === REAL_CORRELATOR_ID);
    expect(worker).toBeTruthy();
  });

  test('unbekannter Correlator wird mit 404 abgelehnt (kein dynamisches Laden)', () => {
    expect(() => getCorrelator('totally-unknown')).toThrow();
    try { getCorrelator('totally-unknown'); } catch (e) { expect(e.status).toBe(404); }
  });

  test('getCorrelator(realer) liefert engineVersion = ce-4 (aus der Domain, keine Magie)', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID);
    expect(c.engineVersion).toBe(CORRELATION_ENGINE_VERSION);
    expect(c.engineVersion).toBe('ce-4');
  });

  test('jeder Correlator trägt id/name/description/inputSources/outputTypes/configCapabilityIds', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID);
    expect(typeof c.name).toBe('string');
    expect(typeof c.description).toBe('string');
    expect(Array.isArray(c.inputSources)).toBe(true);
    expect(Array.isArray(c.outputTypes)).toBe(true);
    expect(Array.isArray(c.configCapabilityIds)).toBe(true);
    expect(c.configCapabilityIds.length).toBeGreaterThanOrEqual(1);
    expect(RISK_CLASSES).toContain(c.riskClass);
  });

  test('toJSON exportiert KEINE Funktion/Code — nur serialisierbare Stammdaten', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID).toJSON();
    for (const v of Object.values(c)) expect(typeof v).not.toBe('function');
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('CorrelatorRegistryCatalog — Capability-Bindung (nur erlaubte)', () => {
  test('gebundene Capability wird akzeptiert', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID);
    const bound = c.configCapabilityIds[0];
    expect(() => assertCapabilityBound(c, bound)).not.toThrow();
  });

  test('nicht gebundene (aber existierende) Capability → 400 deny', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID);
    // collector.firewall.maxLineBytes existiert im Config-Catalog, ist aber NICHT
    // an diesen Correlator gebunden → darf nicht über den Correlator administriert werden.
    expect(() => assertCapabilityBound(c, 'collector.firewall.maxLineBytes')).toThrow();
    try { assertCapabilityBound(c, 'collector.firewall.maxLineBytes'); } catch (e) { expect(e.status).toBe(400); }
  });

  test('die realen Bindungen sind echte P_CONFIG_1-Capabilities (correlator.worker.*)', () => {
    const c = getCorrelator(REAL_CORRELATOR_ID);
    expect(c.configCapabilityIds).toContain('correlator.worker.maxChildren');
    expect(c.configCapabilityIds).toContain('correlator.worker.maxRetries');
  });
});
