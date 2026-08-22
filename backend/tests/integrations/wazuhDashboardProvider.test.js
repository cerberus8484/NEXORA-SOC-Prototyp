'use strict';

const { WazuhDashboardProvider } = require('../../src/integrations/adapters/wazuh/WazuhDashboardProvider');

const INDEXER_DTO = {
  kpis: { alertsToday: 1248, alertsTodayDeltaPct: 18.6, critical: 34, criticalDeltaPct: 30.8, ruleMatches: 6842, threatIntelMatches: 112 },
  timeSeries: [{ t: 't1', count: 5 }],
  severity: { critical: 34, high: 312, medium: 612, low: 290 },
  recentAlerts: [{ time: 't', ruleId: '100201', severity: 'high' }],
  topTactics: [{ tactic: 'Execution', count: 198, pct: 18.4, techniques: ['T1059'] }],
  topHosts: [{ host: 'CLIENT-042', count: 412 }],
  topSourceIps: [{ ip: '185.220.101.12', count: 48, reputation: 'unknown' }],
};

const fakeIndexer = (enabled) => ({ isEnabled: () => enabled, dashboard: async () => INDEXER_DTO });
const fakeApi = (enabled) => ({
  isEnabled: () => enabled,
  listAgents: async () => [
    { id: '1', name: 'CLIENT-042', ip: '192.168.240.44', status: 'active' },
    { id: '2', name: 'SERVER-DB-01', ip: '192.168.240.30', status: 'disconnected' },
  ],
  rulesSummary: async () => ({ total: 9842, enabled: 9032, disabled: 810 }),
});

describe('WazuhDashboardProvider', () => {
  test('isEnabled true, sobald eine Quelle konfiguriert ist', () => {
    expect(new WazuhDashboardProvider({}).isEnabled()).toBe(false);
    expect(new WazuhDashboardProvider({ indexer: fakeIndexer(true) }).isEnabled()).toBe(true);
    expect(new WazuhDashboardProvider({ apiClient: fakeApi(true) }).isEnabled()).toBe(true);
  });

  test('komponiert das volle DTO aus Indexer + API + Incidents', async () => {
    const p = new WazuhDashboardProvider({
      indexer: fakeIndexer(true), apiClient: fakeApi(true), countOpenIncidents: async () => 17,
    });
    const d = await p.getDashboard();

    expect(d.siem).toBe('wazuh');
    expect(d.sources).toEqual({ indexer: true, api: true });
    expect(d.kpis.alertsToday).toBe(1248);
    expect(d.kpis.activeAgents).toBe(1);   // nur 'active'
    expect(d.kpis.agentsTotal).toBe(2);
    expect(d.kpis.openIncidents).toBe(17);
    expect(d.alerts.severity.medium).toBe(612);
    expect(d.agents.offline).toBe(1);
    expect(d.ruleHealth.total).toBe(9842);
  });

  test('ohne Indexer → alerts null, KPIs leer, aber Agents/Incidents real', async () => {
    const p = new WazuhDashboardProvider({
      indexer: fakeIndexer(false), apiClient: fakeApi(true), countOpenIncidents: async () => 5,
    });
    const d = await p.getDashboard();

    expect(d.sources.indexer).toBe(false);
    expect(d.alerts).toBeNull();
    expect(d.kpis.alertsToday).toBeNull();
    expect(d.kpis.activeAgents).toBe(1);
    expect(d.kpis.openIncidents).toBe(5);
  });

  test('getTelemetry reicht Indexer-Telemetrie durch', async () => {
    const TELEMETRY = { range: { hours: 24 }, series: { events: [{ t: 't1', count: 5 }] }, defenderRecent: [] };
    const indexer = { isEnabled: () => true, telemetry: async () => TELEMETRY };
    const p = new WazuhDashboardProvider({ indexer });
    expect(await p.getTelemetry()).toEqual(TELEMETRY);
  });

  test('getTelemetry ohne Indexer oder bei Fehler → null (best-effort)', async () => {
    expect(await new WazuhDashboardProvider({}).getTelemetry()).toBeNull();
    const broken = { isEnabled: () => true, telemetry: async () => { throw new Error('boom'); } };
    expect(await new WazuhDashboardProvider({ indexer: broken }).getTelemetry()).toBeNull();
  });

  test('einzelne Quelle wirft → best-effort, kein harter Fehler', async () => {
    const brokenApi = { isEnabled: () => true, listAgents: async () => { throw new Error('boom'); }, rulesSummary: async () => { throw new Error('boom'); } };
    const p = new WazuhDashboardProvider({ indexer: fakeIndexer(true), apiClient: brokenApi, countOpenIncidents: async () => 0 });
    const d = await p.getDashboard();
    expect(d.agents.total).toBe(0);      // Fallback []
    expect(d.ruleHealth).toBeNull();
    expect(d.kpis.alertsToday).toBe(1248); // Indexer weiterhin da
  });
});
