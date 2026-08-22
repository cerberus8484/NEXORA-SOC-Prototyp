import { api } from '../../lib/apiClient';

export interface SocMetrics {
  mttr: { meanMs: number | null; medianMs: number | null; sampleSize: number };
  // classifiedCount = Nenner der FP-Rate (klassifiziert geschlossen, close_reason<>'').
  fpRate: { rate: number | null; fpCount: number; classifiedCount: number };
  byState: Record<string, number>;
  byStatus: Record<string, number>;
  topRules: { key: string; count: number }[];
  analystLoad: { analyst: string; total: number; open: number }[];
  meta: { totalTickets: number; sampledTickets: number; capped: boolean; since: string | null };
}

export const socMetricsApi = {
  /**
   * Aggregierte SOC-KPIs (engineer/admin).
   * @param since optionaler ISO-Zeitstempel → nur Tickets mit createdAt >= since.
   */
  get: (since?: string | null) =>
    api.get<{ success: boolean; data: SocMetrics }>(
      since ? `/soc-metrics?since=${encodeURIComponent(since)}` : '/soc-metrics',
    ),
};

/** ms → menschenlesbare Dauer (d/h/min). null → '—'. */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/** 0–1 → Prozent-String. null → '—'. */
export function formatRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)} %`;
}
