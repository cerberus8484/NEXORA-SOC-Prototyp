'use strict';

// Reiner Service-Registry-Katalog (managed infrastructure services).
// Sichert die ehrliche Ableitung des `restart.enabled`-Flags + `disabledReason`:
//   - enabled NUR wenn scharfgeschaltet (ENV ODER UI) UND Wazuh-API konfiguriert,
//   - armed/armSource spiegeln die Scharfschaltung + ihre Herkunft,
//   - jeder Disabled-Grund nennt WARUM (nicht konfiguriert vs. nicht scharf),
//   - stabile Shape (id/name/description/category/armed/armSource/connection/restart).

const { buildServiceControlCatalog } = require('../../src/services/serviceControlCatalog');

describe('buildServiceControlCatalog', () => {
  test('liefert genau einen Eintrag: wazuh-manager mit stabiler Shape', () => {
    const catalog = buildServiceControlCatalog({ managerRestartEnabled: true, wazuhConfigured: true });
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(1);

    const svc = catalog[0];
    expect(svc.id).toBe('wazuh-manager');
    expect(svc.name).toBe('Wazuh Manager');
    expect(typeof svc.description).toBe('string');
    expect(svc.description.length).toBeGreaterThan(0);
    expect(svc.category).toBe('SIEM');
    expect(svc.restart).toMatchObject({ supported: true });
    expect(svc).toHaveProperty('restart.enabled');
    expect(svc).toHaveProperty('restart.disabledReason');
    expect(svc).toHaveProperty('armed');
    expect(svc).toHaveProperty('armSource');
    expect(svc).toHaveProperty('connection.configured');
    expect(svc).toHaveProperty('connection.apiConfigured');
    expect(svc).toHaveProperty('connection.indexerConfigured');
  });

  test('ENV-Gate AN + Wazuh konfiguriert → enabled=true, armed=true, armSource=env', () => {
    const [svc] = buildServiceControlCatalog({ managerRestartEnabled: true, wazuhConfigured: true });
    expect(svc.restart.enabled).toBe(true);
    expect(svc.restart.disabledReason).toBeNull();
    expect(svc.armed).toBe(true);
    expect(svc.armSource).toBe('env');
  });

  test('DB-Flag scharf (ENV aus) + Wazuh konfiguriert → enabled=true, armed=true, armSource=ui', () => {
    const [svc] = buildServiceControlCatalog({
      managerRestartEnabled: false, managerRestartArmed: true, wazuhConfigured: true,
    });
    expect(svc.restart.enabled).toBe(true);
    expect(svc.restart.disabledReason).toBeNull();
    expect(svc.armed).toBe(true);
    expect(svc.armSource).toBe('ui');
  });

  test('ENV hat Vorrang bei der Quelle, wenn beide scharf sind', () => {
    const [svc] = buildServiceControlCatalog({
      managerRestartEnabled: true, managerRestartArmed: true, wazuhConfigured: true,
    });
    expect(svc.armSource).toBe('env');
  });

  test('Wazuh NICHT konfiguriert (aber scharf) → enabled=false, Grund nennt fehlende API-Konfig, armed=true', () => {
    const [svc] = buildServiceControlCatalog({
      managerRestartArmed: true, wazuhConfigured: false,
    });
    expect(svc.restart.enabled).toBe(false);
    // Ehrlich: scharfgeschaltet, aber ohne API kein Neustart möglich.
    expect(svc.armed).toBe(true);
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
  });

  test('nicht scharf (Wazuh konfiguriert) → enabled=false, Grund "Nicht scharfgeschaltet", armed=false', () => {
    const [svc] = buildServiceControlCatalog({
      managerRestartEnabled: false, managerRestartArmed: false, wazuhConfigured: true,
    });
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Nicht scharfgeschaltet');
    expect(svc.armed).toBe(false);
    expect(svc.armSource).toBeNull();
  });

  test('beide aus → enabled=false; die fehlende Konfiguration hat Vorrang beim Grund', () => {
    const [svc] = buildServiceControlCatalog({ managerRestartEnabled: false, wazuhConfigured: false });
    expect(svc.restart.enabled).toBe(false);
    // Ohne konfigurierte API kann ohnehin nicht neu gestartet werden → dieser Grund zuerst.
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
    expect(svc.armed).toBe(false);
  });

  test('fehlende/undefined Flags werden konservativ als falsch behandelt (kein Crash)', () => {
    const [svc] = buildServiceControlCatalog({});
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
    expect(svc.armed).toBe(false);
    expect(svc.armSource).toBeNull();
  });

  test('Indexer-only bleibt als Verbindung sichtbar, obwohl Restart weiter gesperrt ist', () => {
    const [svc] = buildServiceControlCatalog({
      managerRestartArmed: true,
      wazuhConnection: { apiConfigured: false, indexerConfigured: true },
    });
    expect(svc.connection).toEqual({
      configured: true,
      apiConfigured: false,
      indexerConfigured: true,
    });
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
  });
});
