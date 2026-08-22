import { sourceLabel } from '../dashboard/sourceActivityModel';
import type { IntegrationStatus } from '../integrations/integrationsView';
import type { SourceActivity } from './collectorsStatusApi';

const MONITORED_SOURCE_IDS = new Set(['wazuh', 'qradar', 'splunk', 'email']);

export interface SourceHealthRow {
  source: string;
  label: string;
  endpoint: string;
  configured: boolean;
  recent: number;
  total: number;
  lastSeen: string | null;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  statusLabel: string;
  detail: string;
}

export interface SourceHealthSummary {
  healthy: number;
  attention: number;
  notConfigured: number;
  total: number;
}

function hoursSince(lastSeen: string, now: Date): number | null {
  const stamp = new Date(lastSeen);
  if (Number.isNaN(stamp.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 3600000));
}

function quietLabel(lastSeen: string | null, now: Date): string {
  if (!lastSeen) return 'Noch nie gesehen';
  const hours = hoursSince(lastSeen, now);
  if (hours == null) return 'Zuletzt gesehen unbekannt';
  if (hours < 24) return `Still seit ${Math.max(1, hours)}h`;
  const days = Math.round(hours / 24);
  return `Still seit ${Math.max(1, days)}d`;
}

function buildRow(integration: IntegrationStatus, activity: SourceActivity | undefined, now: Date): SourceHealthRow {
  const recent = activity?.recent ?? 0;
  const total = activity?.total ?? 0;
  const lastSeen = activity?.lastSeen ?? null;

  if (!integration.configured) {
    return {
      source: integration.id,
      label: sourceLabel(integration.id),
      endpoint: '',
      configured: false,
      recent,
      total,
      lastSeen,
      tone: 'muted',
      statusLabel: 'Nicht konfiguriert',
      detail: 'Quelle ist noch nicht eingerichtet.',
    };
  }

  if (recent > 0) {
    return {
      source: integration.id,
      label: sourceLabel(integration.id),
      endpoint: integration.endpoint,
      configured: true,
      recent,
      total,
      lastSeen,
      tone: 'success',
      statusLabel: 'Liefert Tickets',
      detail: `${recent.toLocaleString('de-DE')} Tickets in den letzten 24h`,
    };
  }

  if (lastSeen) {
    return {
      source: integration.id,
      label: sourceLabel(integration.id),
      endpoint: integration.endpoint,
      configured: true,
      recent,
      total,
      lastSeen,
      tone: 'warning',
      statusLabel: quietLabel(lastSeen, now),
      detail: `${total.toLocaleString('de-DE')} gesamt, aktuell 0 in 24h`,
    };
  }

  return {
    source: integration.id,
    label: sourceLabel(integration.id),
    endpoint: integration.endpoint,
    configured: true,
    recent,
    total,
    lastSeen,
    tone: 'danger',
    statusLabel: 'Noch nie gesehen',
    detail: 'Konfiguriert, aber bisher sind keine Tickets angekommen.',
  };
}

export function buildSourceHealthRows(
  integrations: readonly IntegrationStatus[],
  sources: readonly SourceActivity[],
  now = new Date(),
): SourceHealthRow[] {
  const sourceMap = new Map(sources.map((item) => [item.source, item]));
  const rank: Record<SourceHealthRow['tone'], number> = { danger: 0, warning: 1, success: 2, muted: 3 };

  return integrations
    .filter((item) => MONITORED_SOURCE_IDS.has(item.id))
    .map((item) => buildRow(item, sourceMap.get(item.id), now))
    // Reine Platzhalter ausblenden: Quellen, die nie konfiguriert wurden UND nie Daten
    // geliefert haben (z.B. QRadar/Splunk, die es hier nicht gibt). Konfigurierte Quellen
    // bleiben immer sichtbar — auch „still", denn das ist ein echtes Health-Signal.
    .filter((row) => row.configured || row.total > 0 || row.lastSeen !== null)
    .sort((a, b) => rank[a.tone] - rank[b.tone] || a.label.localeCompare(b.label));
}

export function summarizeSourceHealth(rows: readonly SourceHealthRow[]): SourceHealthSummary {
  return rows.reduce<SourceHealthSummary>((acc, row) => {
    acc.total += 1;
    if (row.tone === 'success') acc.healthy += 1;
    else if (row.tone === 'muted') acc.notConfigured += 1;
    else acc.attention += 1;
    return acc;
  }, { healthy: 0, attention: 0, notConfigured: 0, total: 0 });
}
