'use strict';

/**
 * Unit-Tests für buildApiInfo (reine Mapping-Funktion).
 *
 * TDD-Reihenfolge: Test zuerst (RED) → Implementierung (GREEN).
 *
 * KRITISCH: Kein Secret in der Response — hmacConfigured ist IMMER nur boolean.
 */

const { buildApiInfo } = require('../../src/integrations/apiInfoBuilder');

// KNOWN_SOURCES aus der echten Domain importieren
const { KNOWN_SOURCES } = require('../../src/integrations/IntegrationEvent');

describe('buildApiInfo — reine Mapping-Logik', () => {

  // ── Basisstruktur ─────────────────────────────────────────────────────────

  it('gibt rateLimit + webhookReceivers zurück', () => {
    const result = buildApiInfo({}, {});
    expect(result).toHaveProperty('rateLimit');
    expect(result).toHaveProperty('webhookReceivers');
  });

  it('rateLimit enthält max, windowMs, webhookMax', () => {
    const config = { rateLimit: { max: 200, windowMs: 60000, webhookMax: 1000 } };
    const result = buildApiInfo({}, config);
    expect(result.rateLimit.max).toBe(200);
    expect(result.rateLimit.windowMs).toBe(60000);
    expect(result.rateLimit.webhookMax).toBe(1000);
  });

  it('webhookReceivers enthält je einen Eintrag pro KNOWN_SOURCE', () => {
    const result = buildApiInfo({}, {});
    expect(result.webhookReceivers.length).toBe(KNOWN_SOURCES.length);
    for (const source of KNOWN_SOURCES) {
      const entry = result.webhookReceivers.find((r) => r.source === source);
      expect(entry).toBeDefined();
    }
  });

  it('path je Receiver = /api/v1/integrations/<source>/webhook', () => {
    const result = buildApiInfo({}, {});
    for (const receiver of result.webhookReceivers) {
      expect(receiver.path).toBe(`/api/v1/integrations/${receiver.source}/webhook`);
    }
  });

  // ── hmacConfigured Logik ──────────────────────────────────────────────────

  it('hmacConfigured = false wenn kein Secret gesetzt', () => {
    const result = buildApiInfo({}, {});
    for (const receiver of result.webhookReceivers) {
      expect(receiver.hmacConfigured).toBe(false);
    }
  });

  it('hmacConfigured = true wenn WEBHOOK_SECRET_<SOURCE> gesetzt', () => {
    const env = { WEBHOOK_SECRET_WAZUH: 'super-geheim' };
    const result = buildApiInfo(env, {});
    const wazuh = result.webhookReceivers.find((r) => r.source === 'wazuh');
    expect(wazuh.hmacConfigured).toBe(true);
  });

  it('hmacConfigured = true wenn WEBHOOK_SECRET_GENERIC gesetzt (alle Quellen)', () => {
    const env = { WEBHOOK_SECRET_GENERIC: 'generic-secret' };
    const result = buildApiInfo(env, {});
    for (const receiver of result.webhookReceivers) {
      expect(receiver.hmacConfigured).toBe(true);
    }
  });

  it('quell-spezifisches Secret hat Vorrang vor GENERIC', () => {
    const env = {
      WEBHOOK_SECRET_QRADAR:  'qradar-secret',
      WEBHOOK_SECRET_GENERIC: 'generic-secret',
    };
    const result = buildApiInfo(env, {});
    const qradar = result.webhookReceivers.find((r) => r.source === 'qradar');
    const wazuh  = result.webhookReceivers.find((r) => r.source === 'wazuh');
    expect(qradar.hmacConfigured).toBe(true);
    // Wazuh hat kein eigenes Secret, aber GENERIC greift
    expect(wazuh.hmacConfigured).toBe(true);
  });

  // ── SECRET-LEAK-SCHUTZ ─────────────────────────────────────────────────────
  // KRITISCH: Response darf NIEMALS einen Secret-Wert enthalten.
  // Nur hmacConfigured (boolean) ist erlaubt.

  it('SECRET-LEAK: hmacConfigured ist BOOLEAN — kein Secret-Wert', () => {
    const env = {
      WEBHOOK_SECRET_WAZUH:   'super-geheim-wazuh',
      WEBHOOK_SECRET_QRADAR:  'super-geheim-qradar',
      WEBHOOK_SECRET_GENERIC: 'generic-secret-value',
    };
    const result = buildApiInfo(env, {});
    for (const receiver of result.webhookReceivers) {
      // hmacConfigured muss ein boolean sein — kein string, kein Objekt
      expect(typeof receiver.hmacConfigured).toBe('boolean');
    }
  });

  it('SECRET-LEAK: JSON-Serialisierung enthält keine Secret-Werte', () => {
    const env = {
      WEBHOOK_SECRET_WAZUH:   'mein-geheimes-wazuh-secret',
      WEBHOOK_SECRET_QRADAR:  'mein-geheimes-qradar-secret',
      WEBHOOK_SECRET_GENERIC: 'mein-generic-secret',
    };
    const result = buildApiInfo(env, {});
    const json = JSON.stringify(result);

    // Keiner der Secret-Werte darf im JSON auftauchen
    expect(json).not.toContain('mein-geheimes-wazuh-secret');
    expect(json).not.toContain('mein-geheimes-qradar-secret');
    expect(json).not.toContain('mein-generic-secret');
  });

  it('SECRET-LEAK: Receiver-Objekt hat kein Feld secret/key/password/token', () => {
    const env = { WEBHOOK_SECRET_WAZUH: 'pw123', WEBHOOK_SECRET_GENERIC: 'gen123' };
    const result = buildApiInfo(env, {});
    const SECRET_FIELDS = ['secret', 'key', 'password', 'token', 'apiKey', 'api_key', 'hmacSecret'];
    for (const receiver of result.webhookReceivers) {
      for (const field of SECRET_FIELDS) {
        expect(receiver).not.toHaveProperty(field);
      }
    }
  });

  // ── Typvalidierung ─────────────────────────────────────────────────────────

  it('rateLimit-Felder sind Zahlen', () => {
    const config = { rateLimit: { max: 100, windowMs: 30000, webhookMax: 500 } };
    const result = buildApiInfo({}, config);
    expect(typeof result.rateLimit.max).toBe('number');
    expect(typeof result.rateLimit.windowMs).toBe('number');
    expect(typeof result.rateLimit.webhookMax).toBe('number');
  });

  it('source + path sind Strings', () => {
    const result = buildApiInfo({}, {});
    for (const receiver of result.webhookReceivers) {
      expect(typeof receiver.source).toBe('string');
      expect(typeof receiver.path).toBe('string');
    }
  });

  // ── Fallback-Defaults ──────────────────────────────────────────────────────

  it('nutzt Defaults wenn rateLimit fehlt', () => {
    const result = buildApiInfo({}, {});
    // Muss einen sinnvollen Default haben (nicht 0 oder undefined)
    expect(result.rateLimit.max).toBeGreaterThan(0);
    expect(result.rateLimit.windowMs).toBeGreaterThan(0);
    expect(result.rateLimit.webhookMax).toBeGreaterThan(0);
  });
});
