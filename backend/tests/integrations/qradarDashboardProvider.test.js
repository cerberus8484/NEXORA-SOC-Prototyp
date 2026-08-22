'use strict';

const { QRadarDashboardProvider, qradarDashboardProvider, mapOffenseDto } =
  require('../../src/integrations/adapters/qradar/QRadarDashboardProvider');

describe('QRadarDashboardProvider (env-gated, keine Dummy-Daten)', () => {
  const provider = new QRadarDashboardProvider();

  const ORIG = { url: process.env.QRADAR_BASE_URL, token: process.env.QRADAR_TOKEN };
  afterEach(() => {
    if (ORIG.url == null) delete process.env.QRADAR_BASE_URL; else process.env.QRADAR_BASE_URL = ORIG.url;
    if (ORIG.token == null) delete process.env.QRADAR_TOKEN; else process.env.QRADAR_TOKEN = ORIG.token;
  });

  test('Singleton exportiert und key = "qradar"', () => {
    expect(qradarDashboardProvider).toBeInstanceOf(QRadarDashboardProvider);
    expect(qradarDashboardProvider.key).toBe('qradar');
  });

  describe('isEnabled()', () => {
    test('false ohne QRadar-Konfiguration', () => {
      delete process.env.QRADAR_BASE_URL;
      delete process.env.QRADAR_TOKEN;
      expect(provider.isEnabled()).toBe(false);
    });

    test('false wenn nur eine der beiden Variablen gesetzt ist', () => {
      process.env.QRADAR_BASE_URL = 'https://qradar.example';
      delete process.env.QRADAR_TOKEN;
      expect(provider.isEnabled()).toBe(false);
    });

    test('true erst wenn BASE_URL und TOKEN gesetzt sind', () => {
      process.env.QRADAR_BASE_URL = 'https://qradar.example';
      process.env.QRADAR_TOKEN = 'secret';
      expect(provider.isEnabled()).toBe(true);
    });
  });

  describe('keine Dummy-Daten', () => {
    test('getOffenses() liefert leeres Array (OPEN + ALL)', async () => {
      expect(await provider.getOffenses()).toEqual([]);
      expect(await provider.getOffenses('ALL')).toEqual([]);
    });

    test('getOffense() liefert immer null', async () => {
      expect(await provider.getOffense(1042)).toBeNull();
      expect(await provider.getOffense('abc')).toBeNull();
    });

    test('getOffenseEvents() liefert leeres Array', async () => {
      expect(await provider.getOffenseEvents(1042)).toEqual([]);
      expect(await provider.getOffenseEvents('xyz')).toEqual([]);
    });
  });

  describe('mapOffenseDto — rohe QRadar-Felder (snake_case) → QRadarOffense (camelCase)', () => {
    const RAW = {
      id: 1042, offense_name: 'SSH Brute Force', description: 'Multiple failed logins',
      status: 'OPEN', severity: 8, credibility: 7, relevance: 6, magnitude: 7,
      categories: ['Authentication', 'Recon'], event_count: 254, flow_count: 12, source_count: 3,
      source_addresses: ['45.143.200.12'], local_destination_addresses: ['10.0.0.5'],
      assigned_to: 'analyst1', start_time: 1750000000000, last_updated_time: 1750000600000,
    };

    test('mappt alle Felder auf camelCase', () => {
      const o = mapOffenseDto(RAW);
      expect(o.offenseName).toBe('SSH Brute Force');
      expect(o.eventCount).toBe(254);
      expect(o.flowCount).toBe(12);
      expect(o.sourceCount).toBe(3);
      expect(o.sourceIps).toEqual(['45.143.200.12']);
      expect(o.destIps).toEqual(['10.0.0.5']);
      expect(o.assignedTo).toBe('analyst1');
      expect(o.categories).toEqual(['Authentication', 'Recon']);
      expect(o.severity).toBe(8);
      expect(o.priority).toBe('high'); // score 8*.6+7*.2+6*.2 = 7.4 → high
      expect(o.startTime).toBe(new Date(1750000000000).toISOString());
      expect(o.lastUpdated).toBe(new Date(1750000600000).toISOString());
      expect(o).not.toHaveProperty('offense_name'); // kein Roh-Feld
    });

    test('fehlende Felder → sichere Defaults (nie undefined)', () => {
      const o = mapOffenseDto({ id: 7 });
      expect(o.offenseName).toBe('');
      expect(o.categories).toEqual([]);
      expect(o.sourceIps).toEqual([]);
      expect(o.destIps).toEqual([]);
      expect(o.flowCount).toBe(0);
      expect(o.assignedTo).toBeNull();
      expect(o.mitreT).toEqual([]);
      expect(o.logSources).toEqual([]);
      expect(o.startTime).toBe('');
    });

    test('null/garbage → null', () => {
      expect(mapOffenseDto(null)).toBeNull();
      expect(mapOffenseDto('x')).toBeNull();
    });
  });

  describe('verbundene QRadar-Daten (injizierter HTTP) — Mapping greift', () => {
    function connected(http) {
      process.env.QRADAR_BASE_URL = 'https://qradar.example';
      process.env.QRADAR_TOKEN = 'secret';
      return new QRadarDashboardProvider({ http });
    }

    test('getOffenses() liefert camelCase-DTOs statt roher Felder', async () => {
      const http = { request: async () => ({ data: [{ id: 1, offense_name: 'X', severity: 9, event_count: 5, start_time: 1750000000000 }] }) };
      const list = await connected(http).getOffenses();
      expect(list).toHaveLength(1);
      expect(list[0].offenseName).toBe('X');
      expect(list[0].eventCount).toBe(5);
      expect(list[0]).not.toHaveProperty('offense_name');
    });

    test('getOffense() mappt den Einzel-Datensatz', async () => {
      const http = { request: async () => ({ data: { id: 42, offense_name: 'Y', severity: 5 } }) };
      const o = await connected(http).getOffense(42);
      expect(o.offenseName).toBe('Y');
      expect(o.id).toBe(42);
    });

    test('getStats() funktioniert weiter auf Roh-Feldern (nicht durch Mapping gebrochen)', async () => {
      const http = { request: async () => ({ data: [{ id: 1, severity: 9, event_count: 5 }, { id: 2, severity: 7, event_count: 3 }] }) };
      const stats = await connected(http).getStats();
      expect(stats.openCount).toBe(2);
      expect(stats.criticalCount).toBe(1); // severity 9 → critical
      expect(stats.totalEvents).toBe(8);
      expect(stats.connected).toBe(true);
    });
  });

  describe('getStats()', () => {
    test('liefert genullte, formgleiche Stats', async () => {
      const stats = await provider.getStats();
      expect(stats.openCount).toBe(0);
      expect(stats.criticalCount).toBe(0);
      expect(stats.highCount).toBe(0);
      expect(stats.totalEvents).toBe(0);
      expect(stats.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
      expect(stats.topCategories).toEqual([]);
    });

    test('gibt eine veränderbare Kopie zurück (kein geteiltes EMPTY_STATS)', async () => {
      const a = await provider.getStats();
      a.openCount = 99;
      a.bySeverity.critical = 5;
      const b = await provider.getStats();
      expect(b.openCount).toBe(0);
      expect(b.bySeverity.critical).toBe(0);
    });
  });
});
