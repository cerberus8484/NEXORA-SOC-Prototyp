import type { TelemetryPoint } from './siemApi';

// Pure Helpers für die Telemetrie-Charts — getrennt vom Canvas-Rendering,
// damit die Logik unit-testbar bleibt.

/** Rundet ein Serien-Maximum auf eine lesbare Achsen-Obergrenze (1/2.5/5 × 10^n). */
export function niceMax(rawMax: number): number {
  if (rawMax <= 0) return 10;
  const exp = Math.floor(Math.log10(rawMax));
  const base = Math.pow(10, exp);
  for (const step of [1, 1.5, 2, 2.5, 5, 10]) {
    if (rawMax <= step * base) return step * base;
  }
  return 10 * base;
}

/** Summe aller Buckets einer Serie. */
export function seriesTotal(series: TelemetryPoint[]): number {
  return series.reduce((sum, p) => sum + p.count, 0);
}

/** Jüngster Bucket-Wert (0 bei leerer Serie). */
export function lastValue(series: TelemetryPoint[]): number {
  return series.length > 0 ? series[series.length - 1].count : 0;
}

/**
 * Punktweise Summe mehrerer Serien (für Zonen-Graphen: alle Agents eines VLANs).
 * Zeitachse kommt von der ersten nicht-leeren Serie; kürzere Serien zählen 0.
 */
export function sumSeries(seriesList: TelemetryPoint[][]): TelemetryPoint[] {
  const base = seriesList.find((s) => s.length > 0);
  if (!base) return [];
  return base.map((p, i) => ({
    t: p.t,
    count: seriesList.reduce((sum, s) => sum + (s[i]?.count ?? 0), 0),
  }));
}

/** ISO-Zeitstempel → "HH:MM" für Achsen-Beschriftung; ungültig → ''. */
export function bucketTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
