// Lesbare Labels für Ticket-Quellen. `dataplane` = ein vom Outbox-Worker fusionierter
// Cross-Domain-Vorfall (ADR-035) → als „Korrelierter Vorfall" kenntlich. Unbekannte
// Quellen werden unverändert durchgereicht (kein Informationsverlust).
const SOURCE_LABELS: Record<string, string> = {
  wazuh: 'Wazuh',
  qradar: 'QRadar',
  splunk: 'Splunk',
  crowdsec: 'CrowdSec',
  email: 'E-Mail',
  servicenow: 'ServiceNow',
  otrs: 'OTRS',
  soar: 'SOAR',
  generic: 'Webhook',
  manual: 'Manuell',
  dataplane: 'Korrelierter Vorfall',
};

export function sourceLabel(source?: string | null): string {
  const key = (source ?? '').trim().toLowerCase();
  if (!key) return 'Manuell';
  return SOURCE_LABELS[key] ?? source!.trim();
}

/** Cross-Domain-Vorfall aus der Korrelierungs-Engine (Data Plane)? */
export function isCorrelatedSource(source?: string | null): boolean {
  return (source ?? '').trim().toLowerCase() === 'dataplane';
}
