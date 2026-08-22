import { api } from '../../lib/apiClient';

// DTO der SIEM-Dashboard-Route (GET /api/v1/siem/:siem/dashboard).
// Gleiche Form für jede künftige SIEM-Quelle (Wazuh, Splunk, QRadar …).

export interface SiemKpis {
  alertsToday: number | null;
  alertsTodayDeltaPct: number | null;
  critical: number | null;
  criticalDeltaPct: number | null;
  ruleMatches: number | null;
  threatIntelMatches: number | null;
  activeAgents: number;
  agentsTotal: number;
  openIncidents: number | null;
}

export interface SiemRecentAlert {
  time: string;
  ruleId?: string;
  level: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description?: string;
  host?: string;
  srcIp?: string | null;
  dstIp?: string | null;
}

export interface SiemAgentSummary {
  total: number;
  online: number;
  offline: number;
  pending: number;
  list: { id: string; name: string; ip?: string; status?: string; lastKeepAlive?: string }[];
}

export interface SiemDashboard {
  siem: string;
  generatedAt: string;
  sources: { indexer: boolean; api: boolean };
  kpis: SiemKpis;
  alerts: {
    timeSeries: { t: string; count: number }[];
    severity: { critical: number; high: number; medium: number; low: number };
    recent: SiemRecentAlert[];
    topTactics: { tactic: string; count: number; pct: number; techniques: string[] }[];
    topHosts: { host: string; count: number }[];
    topSourceIps: { ip: string; count: number; reputation: string }[];
  } | null;
  agents: SiemAgentSummary;
  ruleHealth: { total: number; enabled: number; disabled: number } | null;
}

export interface SiemDashboardResponse {
  enabled: boolean;
  siem: string;
  data: SiemDashboard | null;
}

// DTO der Telemetrie-Route (GET /api/v1/siem/:siem/telemetry) — Zeitreihen
// als reine Zähler pro Zeitfenster (keine PII in den Aggregaten).

export interface TelemetryPoint {
  t: string;
  count: number;
}

export interface SiemTelemetry {
  range: { hours: number; interval: string };
  series: {
    events: TelemetryPoint[];
    alerts: TelemetryPoint[];
    dcLogons: TelemetryPoint[];
    dcFailed: TelemetryPoint[];
    defender: TelemetryPoint[];
    fwBlock: TelemetryPoint[];
    fwPass: TelemetryPoint[];
    /** Via WEF am Collector eingesammelte Fremd-Events (z.B. DC01 → WEC01). */
    wef: TelemetryPoint[];
    /** Agent-Buffer-Warnungen (Wazuh-Regel 202/203) — Host droht Events zu verwerfen. */
    agentBuffer: TelemetryPoint[];
  };
  /** Events pro Wazuh-Agent — Basis für die Netz-Zonen-Graphen (Mapping in topology.ts). */
  agents: { name: string; points: TelemetryPoint[] }[];
  defenderRecent: {
    time: string;
    host: string | null;
    eventID: string | null;
    level: number;
    description: string | null;
    threat: string | null;
    action: string | null;
    path: string | null;
  }[];
  /** Letzte Alerts für den Live-Eventstream (gleiche Form wie Dashboard-recent). */
  recent: SiemRecentAlert[];
  /**
   * Agents mit vollem Event-Puffer (Wazuh-Regel 202/203) im Zeitfenster.
   * warn = 202-Treffer (Queue ~90% voll) · full = 203-Treffer (Events verworfen).
   */
  bufferAgents: { name: string; warn: number; full: number }[];
}

export interface SiemTelemetryResponse {
  enabled: boolean;
  siem: string;
  data: SiemTelemetry | null;
}

export const siemApi = {
  dashboard: (siem: string) => api.get<SiemDashboardResponse>(`/siem/${siem}/dashboard`),
  telemetry: (siem: string) => api.get<SiemTelemetryResponse>(`/siem/${siem}/telemetry`),
  list: () => api.get<{ data: { key: string; enabled: boolean }[] }>('/siem'),
};
