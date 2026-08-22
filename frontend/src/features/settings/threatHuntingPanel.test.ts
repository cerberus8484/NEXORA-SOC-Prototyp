/**
 * TDD RED — ThreatHuntingPanel Helfer
 *
 * Testet reine Hilfsfunktionen aus threatHuntingHelpers.ts.
 * Kein React, kein DOM, kein Buffer — läuft sauber in Vitest.
 *
 * ADR-009: Ehrlichkeits-Regel — keine Fake-Daten, Scheduling ehrlich "geplant".
 */
import { describe, test, expect } from 'vitest';
import {
  riskLevelLabel,
  riskLevelTone,
  catalogApiPath,
  formatCatalogItem,
} from './threatHuntingHelpers';
import type { CatalogItemDisplay } from './threatHuntingHelpers';

// ── riskLevelLabel ─────────────────────────────────────────────────────────────

describe('riskLevelLabel', () => {
  test('gibt "Niedrig" für low zurück', () => {
    expect(riskLevelLabel('low')).toBe('Niedrig');
  });

  test('gibt "Mittel" für medium zurück', () => {
    expect(riskLevelLabel('medium')).toBe('Mittel');
  });

  test('gibt "Hoch" für high zurück', () => {
    expect(riskLevelLabel('high')).toBe('Hoch');
  });

  test('gibt "Kritisch" für critical zurück', () => {
    expect(riskLevelLabel('critical')).toBe('Kritisch');
  });

  test('gibt unbekannte Werte unverändert zurück', () => {
    expect(riskLevelLabel('unknown')).toBe('unknown');
    expect(riskLevelLabel('')).toBe('');
  });
});

// ── riskLevelTone ──────────────────────────────────────────────────────────────

describe('riskLevelTone', () => {
  test('low → success', () => {
    expect(riskLevelTone('low')).toBe('success');
  });

  test('medium → accent', () => {
    expect(riskLevelTone('medium')).toBe('accent');
  });

  test('high → warning', () => {
    expect(riskLevelTone('high')).toBe('warning');
  });

  test('critical → danger', () => {
    expect(riskLevelTone('critical')).toBe('danger');
  });

  test('unbekannter Wert → muted', () => {
    expect(riskLevelTone('unknown')).toBe('muted');
    expect(riskLevelTone('')).toBe('muted');
  });
});

// ── catalogApiPath ─────────────────────────────────────────────────────────────

describe('catalogApiPath', () => {
  test('gibt exakt den richtigen API-Pfad zurück', () => {
    // Vertrag: huntApi.catalog() ruft /hunts/catalog auf — dieser Test sichert das ab.
    expect(catalogApiPath()).toBe('/hunts/catalog');
  });
});

// ── formatCatalogItem ──────────────────────────────────────────────────────────

describe('formatCatalogItem', () => {
  const rawItem = {
    key:           'suspicious_powershell_hunt',
    label:         'Suspicious PowerShell Hunt',
    description:   'Encoded/obfuscated PowerShell-Ausführung auf Windows-Hosts.',
    category:      'detection',
    mitre:         'T1059.001',
    dataSources:   ['Sysmon', 'Wazuh'],
    targetType:    'host',
    defaultTarget: 'Windows-01',
    defaultIp:     '',
    riskLevel:     'high',
  };

  test('überträgt key, label und description unverändert', () => {
    const result: CatalogItemDisplay = formatCatalogItem(rawItem);
    expect(result.key).toBe('suspicious_powershell_hunt');
    expect(result.label).toBe('Suspicious PowerShell Hunt');
    expect(result.description).toBe('Encoded/obfuscated PowerShell-Ausführung auf Windows-Hosts.');
  });

  test('ergänzt riskLabel aus riskLevel', () => {
    const result = formatCatalogItem(rawItem);
    expect(result.riskLabel).toBe('Hoch');
  });

  test('ergänzt riskTone aus riskLevel', () => {
    const result = formatCatalogItem(rawItem);
    expect(result.riskTone).toBe('warning');
  });

  test('behält riskLevel im Ergebnis', () => {
    const result = formatCatalogItem(rawItem);
    expect(result.riskLevel).toBe('high');
  });

  test('behält mitre im Ergebnis', () => {
    const result = formatCatalogItem(rawItem);
    expect(result.mitre).toBe('T1059.001');
  });

  test('enthält dataSources-Array', () => {
    const result = formatCatalogItem(rawItem);
    expect(result.dataSources).toEqual(['Sysmon', 'Wazuh']);
  });

  test('verarbeitet critical riskLevel korrekt', () => {
    const critical = { ...rawItem, riskLevel: 'critical' };
    const result = formatCatalogItem(critical);
    expect(result.riskLabel).toBe('Kritisch');
    expect(result.riskTone).toBe('danger');
  });

  test('verarbeitet low riskLevel korrekt', () => {
    const low = { ...rawItem, riskLevel: 'low' };
    const result = formatCatalogItem(low);
    expect(result.riskLabel).toBe('Niedrig');
    expect(result.riskTone).toBe('success');
  });

  test('verarbeitet leere dataSources korrekt', () => {
    const noSources = { ...rawItem, dataSources: [] };
    const result = formatCatalogItem(noSources);
    expect(result.dataSources).toEqual([]);
  });

  test('verarbeitet fehlendes mitre (leerer String) korrekt', () => {
    const noMitre = { ...rawItem, mitre: '' };
    const result = formatCatalogItem(noMitre);
    expect(result.mitre).toBe('');
  });
});
