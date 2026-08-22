import type { HuntSession } from '../../lib/types';

// Reine Filterlogik der Hunt-Session-Liste (Suche + Status + Analyst + Zeitraum).
// DOM-/API-frei → testbar.

export const SESSION_RANGES: Record<string, number> = {
  '': Infinity,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

export const SESSION_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Gesamter Zeitraum' },
  { value: '24h', label: 'Letzte 24h' },
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
];

export interface SessionFilter {
  q: string;
  status: string;
  analyst: string;
  range: string;
}

export function filterSessions(sessions: HuntSession[], f: SessionFilter, now = Date.now()): HuntSession[] {
  const maxAge = SESSION_RANGES[f.range] ?? Infinity;
  const needle = f.q.trim().toLowerCase();
  return sessions.filter((s) =>
    (!f.status || s.status === f.status)
    && (!f.analyst || s.analystId === f.analyst)
    && (maxAge === Infinity || now - new Date(s.createdAt).getTime() <= maxAge)
    && (!needle || `${s.targetHost} ${s.scope} ${s.analystId}`.toLowerCase().includes(needle)));
}
