// Reine Zeitraum→since-ISO-Logik für das SOC-Metriken-Dashboard (Audit #2).
// Keine Seiteneffekte, keine DOM/Netz-Abhängigkeit → voll testbar.

/** Auswählbare Zeiträume. 'all' = kein Filter (All-Time). */
import i18n from '../../i18n';

export type MetricsRange = '7d' | '30d' | '90d' | 'all';

export interface RangeOption {
  value: MetricsRange;
  label: string;
}

/** Reihenfolge + Beschriftung der Zeitraum-Buttons. */
export const RANGE_OPTIONS: readonly RangeOption[] = [
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: '90d', label: '90 Tage' },
  { value: 'all', label: i18n.t('common.all') },
] as const;

/** Default-Zeitraum beim Laden der Seite. */
export const DEFAULT_RANGE: MetricsRange = '30d';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<MetricsRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Übersetzt einen Zeitraum in einen `since`-ISO-Zeitstempel relativ zu `now`.
 * 'all' → null (kein Filter). `now` ist injizierbar → deterministisch testbar.
 */
export function rangeToSince(range: MetricsRange, now: Date = new Date()): string | null {
  if (range === 'all') return null;
  const days = RANGE_DAYS[range];
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}
