import { describe, test, expect } from 'vitest';
import {
  categoryLabel,
  configuredTone,
  configuredLabel,
  deriveDisplayedStatus,
  mapTestResult,
  buildIntegrationRow,
  type IntegrationStatus,
  type IntegrationTestResponse,
} from './integrationsView';

const base = (over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  id: 'wazuh',
  name: 'Wazuh',
  category: 'siem',
  configured: true,
  endpoint: 'wazuh.example.com:55000',
  status: 'configured',
  testable: true,
  ...over,
});

describe('categoryLabel — bekannte Kategorien lesbar, unbekannte durchgereicht', () => {
  test('mappt die bekannten Kategorien auf deutsche Labels', () => {
    expect(categoryLabel('siem')).toBe('SIEM');
    expect(categoryLabel('threat_intel')).toBe('Threat Intel');
    expect(categoryLabel('llm')).toBe('KI / LLM');
    expect(categoryLabel('ticketing')).toBe('Ticketing');
    expect(categoryLabel('email')).toBe('E-Mail');
  });

  test('reicht unbekannte Kategorie unverändert durch (kein Informationsverlust)', () => {
    expect(categoryLabel('sonstiges')).toBe('sonstiges');
  });
});

describe('configuredTone / configuredLabel — ehrlicher Konfigurations-Status', () => {
  test('konfiguriert → success', () => {
    expect(configuredTone(true)).toBe('success');
    expect(configuredLabel(true)).toBe('Konfiguriert');
  });
  test('nicht konfiguriert → muted', () => {
    expect(configuredTone(false)).toBe('muted');
    expect(configuredLabel(false)).toBe('Nicht konfiguriert');
  });
});

describe('buildIntegrationRow — leitet die Anzeige-Zeile ab', () => {
  test('testbare, konfigurierte Integration → Test erlaubt, Endpoint sichtbar', () => {
    const row = buildIntegrationRow(base());
    expect(row.id).toBe('wazuh');
    expect(row.canTest).toBe(true);
    expect(row.endpoint).toBe('wazuh.example.com:55000');
    expect(row.testDisabledReason).toBeNull();
  });

  test('nicht-testbare Integration → canTest=false + ehrlicher Grund', () => {
    const row = buildIntegrationRow(base({ id: 'qradar', name: 'QRadar', testable: false }));
    expect(row.canTest).toBe(false);
    expect(row.testDisabledReason).toMatch(/Systemstatus/i);
  });

  test('testbar aber nicht konfiguriert → Test gesperrt (nichts zu testen)', () => {
    const row = buildIntegrationRow(base({ configured: false, endpoint: '', status: 'not_configured' }));
    expect(row.canTest).toBe(false);
    expect(row.testDisabledReason).toMatch(/nicht konfiguriert/i);
  });

  test('leerer Endpoint wird als „—" dargestellt (kein erfundener Host)', () => {
    const row = buildIntegrationRow(base({ configured: false, endpoint: '', status: 'not_configured' }));
    expect(row.endpointDisplay).toBe('—');
  });
});

describe('mapTestResult — ehrliches Ergebnis-Mapping (erreichbar/nicht/nicht testbar)', () => {
  test('reachable=true → ok mit Meldung', () => {
    const r = mapTestResult({ reachable: true, message: 'Manager erreichbar' });
    expect(r.tone).toBe('success');
    expect(r.label).toBe('Erreichbar');
    expect(r.message).toBe('Manager erreichbar');
  });

  test('model_missing → Warnung statt verbunden', () => {
    const r = mapTestResult({ reachable: true, modelAvailable: false, reason: 'model_missing', message: 'Modell fehlt' });
    expect(r.tone).toBe('warning');
    expect(r.label).toBe('Modell fehlt');
    expect(r.message).toBe('Modell fehlt');
  });

  test('reachable=false → Fehler-Ton, ehrliche Meldung', () => {
    const r = mapTestResult({ reachable: false, message: 'Verbindung fehlgeschlagen' });
    expect(r.tone).toBe('danger');
    expect(r.label).toBe('Nicht erreichbar');
    expect(r.message).toBe('Verbindung fehlgeschlagen');
  });

  test('testable=false (501) → neutraler Hinweis, kein Fehler-Ton', () => {
    const r = mapTestResult({ testable: false, message: 'kein Live-Test' } as IntegrationTestResponse);
    expect(r.tone).toBe('muted');
    expect(r.label).toBe('Kein Live-Test');
    expect(r.message).toBe('kein Live-Test');
  });

  test('fehlende Meldung → ehrlicher Default statt leer', () => {
    const r = mapTestResult({ reachable: true });
    expect(r.message).toBe('Erreichbar');
  });
});

describe('deriveDisplayedStatus', () => {
  test('erfolgreicher Live-Test hebt auf connected an', () => {
    expect(deriveDisplayedStatus('configured', { reachable: true })).toBe('connected');
  });

  test('fehlendes Modell hebt NICHT auf connected an', () => {
    expect(deriveDisplayedStatus('configured', { reachable: true, modelAvailable: false, reason: 'model_missing' })).toBe('configured');
  });

  test('fehlgeschlagener Live-Test degradiert den gespeicherten Status nicht', () => {
    expect(deriveDisplayedStatus('configured', { reachable: false })).toBe('configured');
    expect(deriveDisplayedStatus('not_configured', { reachable: false })).toBe('not_configured');
  });
});
