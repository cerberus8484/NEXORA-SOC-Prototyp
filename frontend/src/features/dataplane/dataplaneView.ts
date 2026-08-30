// Pure Display-Logik für die Data-Plane-Pipeline-Sicht. KEINE React-Importe —
// nur Mappings (Health/Collector-Status → Tone/Label) und Zeit-Formatierung.
// Damit unabhängig von Komponenten testbar.

import type { Tone } from '../../components/ui';
import type { NodeHealth, CollectorStatus } from './dataplaneApi';
import i18n from '../../i18n';

const HEALTH_TONE: Record<NodeHealth, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  stale: 'muted',
};

const HEALTH_LABEL: Record<NodeHealth, string> = {
  healthy: 'Gesund',
  degraded: i18n.t('app.degraded'),
  stale: 'Veraltet',
};

const COLLECTOR_TONE: Record<CollectorStatus, Tone> = {
  running: 'success',
  completed: 'muted',
  pending: 'warning',
  stopped: 'muted',
  failed: 'danger',
};

const COLLECTOR_LABEL: Record<CollectorStatus, string> = {
  running: i18n.t('app.running'),
  completed: 'Fertig',
  pending: 'Wartet',
  stopped: 'Gestoppt',
  failed: i18n.t('common.error'),
};

export function healthTone(h: NodeHealth): Tone {
  return HEALTH_TONE[h] ?? 'muted';
}

export function healthLabel(h: NodeHealth): string {
  return HEALTH_LABEL[h] ?? 'Unbekannt';
}

export function collectorStatusTone(s: CollectorStatus): Tone {
  return COLLECTOR_TONE[s] ?? 'muted';
}

export function collectorStatusLabel(s: CollectorStatus): string {
  return COLLECTOR_LABEL[s] ?? s;
}

/** Menschlich lesbares Alter eines Snapshots — ehrlich „—" bei unbekannt/negativ. */
export function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return i18n.t('time.secondsAgoTight', { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return i18n.t('time.minutesAgoTight', { count: min });
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return i18n.t('time.hoursAgoTight', { count: hrs });
  return i18n.t('time.daysAgoTight', { count: Math.floor(hrs / 24) });
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
