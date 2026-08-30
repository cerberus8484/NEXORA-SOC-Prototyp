// Reines Modell für die Dashboard-Card „Top Quellen": formt die rohe Ingestion-
// Aktivität je Quelle (aus /collectors/activity) in eine kompakte, sortierte Top-N-Sicht
// mit humanisiertem Label + ehrlicher Liveness. Keine React-/API-Abhängigkeit.

import { type SourceActivity, type SourceLiveness, sourceLiveness } from '../collectors/collectorsStatusApi';

// Anzeige-Labels für die bekannten Ticket-Quellen (SOURCES-Enum, Backend). Fallback =
// Rohwert, damit eine neue Quelle nie verschluckt wird (ehrliche Anzeige, ADR-009).
export const SOURCE_LABELS: Record<string, string> = {
  wazuh: 'Wazuh', qradar: 'QRadar', splunk: 'Splunk', crowdsec: 'CrowdSec',
  email: 'E-Mail', dataplane: 'Korrelierter Vorfall', threat_hunt: 'Threat Hunt',
  manual: 'Manuell', soar: 'SOAR', servicenow: 'ServiceNow', otrs: 'OTRS',
  webhook: 'Webhook', unknown: 'Unbekannt',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export interface SourceActivityRow {
  source: string;
  label: string;
  total: number;
  recent: number;
  lastSeen: string | null;
  liveness: SourceLiveness;
}

const DEFAULT_LIMIT = 6;

/**
 * Top-N Quellen für die kompakte Dashboard-Card. Sortiert nach 24h-Aktivität (recent)
 * desc, dann Gesamt desc, dann Name asc (stabil/deterministisch). Reine Transformation.
 */
export function topSources(sources: SourceActivity[], limit = DEFAULT_LIMIT): SourceActivityRow[] {
  return [...sources]
    .sort((a, b) => b.recent - a.recent || b.total - a.total || a.source.localeCompare(b.source))
    .slice(0, limit)
    .map((s) => ({
      source: s.source,
      label: sourceLabel(s.source),
      total: s.total,
      recent: s.recent,
      lastSeen: s.lastSeen,
      liveness: sourceLiveness(s),
    }));
}
