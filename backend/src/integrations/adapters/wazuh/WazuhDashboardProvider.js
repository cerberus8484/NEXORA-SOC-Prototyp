'use strict';

/**
 * WazuhDashboardProvider — komponiert das SIEM-Dashboard-DTO für Wazuh aus:
 *   - WazuhIndexerClient  (Alerts-Aggregationen, OpenSearch)
 *   - WazuhApiClient      (Agents, Rule-Health, Manager-API)
 *   - countOpenIncidents  (unsere Tickets, injiziert → entkoppelt + testbar)
 *
 * Implementiert die SIEM-Dashboard-Provider-Naht: jede künftige SIEM-Quelle
 * liefert dieselbe DTO-Form (getDashboard) und wird in siemDashboards registriert.
 * Best-effort: einzelne fehlende Quellen → null/leer, kein harter Fehler.
 */
class WazuhDashboardProvider {
  constructor({ indexer = null, apiClient = null, countOpenIncidents = null } = {}) {
    this._indexer = indexer;
    this._api     = apiClient;
    this._countOpenIncidents = countOpenIncidents || (async () => null);
  }

  get key() { return 'wazuh'; }

  // Dashboard ist verfügbar, sobald mindestens eine Quelle konfiguriert ist.
  isEnabled() {
    return Boolean(this._indexer?.isEnabled?.() || this._api?.isEnabled?.());
  }

  async getDashboard() {
    const indexerEnabled = Boolean(this._indexer?.isEnabled?.());
    const apiEnabled     = Boolean(this._api?.isEnabled?.());
    const safe = async (promise, fallback) => { try { return await promise; } catch { return fallback; } };

    const [indexerData, agents, rules, openIncidents] = await Promise.all([
      indexerEnabled ? safe(this._indexer.dashboard(), null) : Promise.resolve(null),
      apiEnabled     ? safe(this._api.listAgents(), [])       : Promise.resolve([]),
      apiEnabled     ? safe(this._api.rulesSummary(), null)   : Promise.resolve(null),
      safe(this._countOpenIncidents(), null),
    ]);

    const agentSummary = this._agentSummary(agents);

    return {
      siem: 'wazuh',
      generatedAt: new Date().toISOString(),
      sources: { indexer: indexerEnabled, api: apiEnabled },
      kpis: {
        alertsToday:         indexerData?.kpis?.alertsToday ?? null,
        alertsTodayDeltaPct: indexerData?.kpis?.alertsTodayDeltaPct ?? null,
        critical:            indexerData?.kpis?.critical ?? null,
        criticalDeltaPct:    indexerData?.kpis?.criticalDeltaPct ?? null,
        ruleMatches:         indexerData?.kpis?.ruleMatches ?? null,
        threatIntelMatches:  indexerData?.kpis?.threatIntelMatches ?? null,
        activeAgents:        agentSummary.online,
        agentsTotal:         agentSummary.total,
        openIncidents,
      },
      alerts: indexerData ? {
        timeSeries:   indexerData.timeSeries,
        severity:     indexerData.severity,
        recent:       indexerData.recentAlerts,
        topTactics:   indexerData.topTactics,
        topHosts:     indexerData.topHosts,
        topSourceIps: indexerData.topSourceIps,
      } : null,
      agents: agentSummary,
      ruleHealth: rules,
    };
  }

  /** Telemetrie-Serien (Indexer-only). Best-effort: kein Indexer / Fehler → null. */
  async getTelemetry(opts) {
    if (!this._indexer?.isEnabled?.()) return null;
    try { return await this._indexer.telemetry(opts); } catch { return null; }
  }

  _agentSummary(agents) {
    const list = Array.isArray(agents) ? agents : [];
    const online  = list.filter((a) => a.status === 'active').length;
    const offline = list.filter((a) => a.status === 'disconnected' || a.status === 'never_connected').length;
    return {
      total: list.length,
      online,
      offline,
      pending: Math.max(0, list.length - online - offline),
      list: list.slice(0, 6).map((a) => ({
        id: a.id, name: a.name, ip: a.ip, status: a.status, lastKeepAlive: a.lastKeepAlive,
      })),
    };
  }
}

module.exports = { WazuhDashboardProvider };
