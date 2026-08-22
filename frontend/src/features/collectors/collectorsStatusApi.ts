// Kollektoren-/Quellen-Status — read-only Ingestion-Aktivität je Quelle.
//
// GET /collectors/activity — echte Ticket-Aktivität je source (total, letzte 24h,
// last-seen). Beantwortet „kommt von Quelle/Kollektor X echt was an?". Der
// Live-Prozessstatus des Collector-Hubs ist bewusst NICHT enthalten (siehe note).

import { api } from '../../lib/apiClient';

export interface SourceActivity {
  source: string;
  total: number;
  recent: number; // letzte 24h
  lastSeen: string | null;
}

export interface CollectorActivity {
  sources: SourceActivity[];
  liveProcessStatus: { available: boolean; note: string };
}

export async function getCollectorActivity(): Promise<CollectorActivity> {
  const env = await api.get<{ data: CollectorActivity }>('/collectors/activity');
  return env.data;
}

/** Ehrlicher Aktivitäts-Status je Quelle aus den realen Zahlen abgeleitet. */
export type SourceLiveness = 'active' | 'quiet' | 'none';

export function sourceLiveness(s: SourceActivity): SourceLiveness {
  if (s.recent > 0) return 'active';      // in den letzten 24h Daten geliefert
  if (s.lastSeen) return 'quiet';         // früher aktiv, aktuell still
  return 'none';                          // nie Daten
}
