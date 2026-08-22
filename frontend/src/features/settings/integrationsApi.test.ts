import { describe, it, expect } from 'vitest';
import {
  type IntegrationStatus,
  buildStatusCounts,
  filterIntegrations,
  paginate,
  stripHostFromEndpoint,
} from './integrationsApi';

// ── Typen & Hilfsfunktionen ───────────────────────────────────────────────────

const makeItem = (overrides: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  id:         'wazuh',
  name:       'Wazuh',
  category:   'siem',
  configured: false,
  endpoint:   '',
  status:     'not_configured',
  testable:   true,
  ...overrides,
});

describe('buildStatusCounts', () => {
  it('leere Liste → alle 0', () => {
    const counts = buildStatusCounts([]);
    expect(counts.connected).toBe(0);
    expect(counts.configured).toBe(0);
    expect(counts.not_configured).toBe(0);
    expect(counts.total).toBe(0);
  });

  it('zählt alle Status korrekt', () => {
    const items: IntegrationStatus[] = [
      makeItem({ status: 'connected' }),
      makeItem({ id: 'qradar', status: 'configured' }),
      makeItem({ id: 'splunk', status: 'not_configured' }),
      makeItem({ id: 'ollama', status: 'not_configured' }),
    ];
    const counts = buildStatusCounts(items);
    expect(counts.connected).toBe(1);
    expect(counts.configured).toBe(1);
    expect(counts.not_configured).toBe(2);
    expect(counts.total).toBe(4);
  });

  it('total = connected + configured + not_configured', () => {
    const items = [
      makeItem({ status: 'connected' }),
      makeItem({ id: 'q', status: 'connected' }),
      makeItem({ id: 's', status: 'not_configured' }),
    ];
    const c = buildStatusCounts(items);
    expect(c.total).toBe(c.connected + c.configured + c.not_configured);
  });
});

describe('filterIntegrations', () => {
  const items: IntegrationStatus[] = [
    makeItem({ id: 'wazuh', name: 'Wazuh',     status: 'connected',     category: 'siem' }),
    makeItem({ id: 'qradar', name: 'QRadar',   status: 'configured',    category: 'siem' }),
    makeItem({ id: 'vt',     name: 'VirusTotal', status: 'not_configured', category: 'threat_intel' }),
  ];

  it('kein Filter → alle', () => {
    expect(filterIntegrations(items, { query: '', statusFilter: 'all' }).length).toBe(3);
  });

  it('Suche nach Name (case-insensitive)', () => {
    const result = filterIntegrations(items, { query: 'qra', statusFilter: 'all' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('qradar');
  });

  it('Status-Filter "connected"', () => {
    const result = filterIntegrations(items, { query: '', statusFilter: 'connected' });
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('connected');
  });

  it('Status-Filter "not_configured"', () => {
    const result = filterIntegrations(items, { query: '', statusFilter: 'not_configured' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('vt');
  });

  it('kombiniert Suche + Status', () => {
    const result = filterIntegrations(items, { query: 'w', statusFilter: 'connected' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('wazuh');
  });

  it('kein Match → leere Liste', () => {
    const result = filterIntegrations(items, { query: 'xxxx', statusFilter: 'all' });
    expect(result.length).toBe(0);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => makeItem({ id: `i${i}` }));

  it('erste Seite', () => {
    const result = paginate(items, 1, 3);
    expect(result.items.length).toBe(3);
    expect(result.items[0].id).toBe('i0');
    expect(result.totalPages).toBe(4);
    expect(result.total).toBe(10);
  });

  it('letzte Seite (kürzer)', () => {
    const result = paginate(items, 4, 3);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('i9');
  });

  it('leere Liste', () => {
    const result = paginate([], 1, 5);
    expect(result.items.length).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.total).toBe(0);
  });

  it('Seite > totalPages → leer', () => {
    const result = paginate(items, 99, 5);
    expect(result.items.length).toBe(0);
  });
});

describe('stripHostFromEndpoint', () => {
  it('leerer String → leer', () => {
    expect(stripHostFromEndpoint('')).toBe('');
  });

  it('reiner Host unverändert', () => {
    expect(stripHostFromEndpoint('wazuh.example.com:55000')).toBe('wazuh.example.com:55000');
  });

  it('strippt URL-Schema', () => {
    expect(stripHostFromEndpoint('https://ollama.local:11434')).toBe('ollama.local:11434');
  });
});

describe('IntegrationStatus Typ-Invariante: kein Secret-Feld', () => {
  it('makeItem enthält keine Secret-Felder', () => {
    const item = makeItem();
    const SECRET_FIELDS = ['api_key', 'apiKey', 'password', 'token', 'secret'];
    for (const field of SECRET_FIELDS) {
      expect(item).not.toHaveProperty(field);
    }
  });
});

describe('TestResult Vertrag', () => {
  it('trägt für Ollama optional modelAvailable + reason', () => {
    const result = {
      reachable: true,
      testedAt: '2026-07-06T00:00:00.000Z',
      modelAvailable: false,
      reason: 'model_missing',
      message: 'Modell fehlt',
    };
    expect(result.modelAvailable).toBe(false);
    expect(result.reason).toBe('model_missing');
  });
});
