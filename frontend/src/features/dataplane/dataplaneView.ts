// Pure Display-Logik für die Data-Plane-Pipeline-Sicht. KEINE React-Importe —
// nur Mappings (Health/Collector-Status → Tone/Label) und Zeit-Formatierung.
// Damit unabhängig von Komponenten testbar.

import type { Tone } from '../../components/ui';
import type { NodeHealth, CollectorStatus } from './dataplaneApi';

const HEALTH_TONE: Record<NodeHealth, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  stale: 'muted',
};

const HEALTH_LABEL: Record<NodeHealth, string> = {
  healthy: 'Gesund',
  degraded: 'Beeinträchtigt',
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
  running: 'Läuft',
  completed: 'Fertig',
  pending: 'Wartet',
  stopped: 'Gestoppt',
  failed: 'Fehler',
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
  if (sec < 60) return `vor ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `vor ${hrs}h`;
  return `vor ${Math.floor(hrs / 24)}d`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
