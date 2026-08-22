/**
 * Reine Transform-Helfer für die Dashboard-Card "Top Erkennungsquellen".
 * Kein JSX, kein DOM — testbar in Vitest ohne jsdom-Setup.
 *
 * Quelle: SocMetrics.topRules (offenseId-Präfix als Rule-Proxy, vom
 * SocMetricsService aggregiert). Wir verändern die Aggregation NICHT —
 * hier wird nur für die Anzeige aufbereitet (Label humanisieren, Top-N kappen).
 */

/** Eine aggregierte Erkennungsquelle (Regel/Offense → Ticket-Anzahl). */
export interface DetectionSource {
  /** Roher Schlüssel aus topRules (z.B. "rule:100205" oder "12345"). */
  key: string;
  /** Anzahl der Tickets, die diese Quelle referenzieren. */
  count: number;
}

/** Eine anzeigefertige Zeile der "Top Erkennungsquellen"-Card. */
export interface DetectionSourceRow {
  /** Roher Schlüssel (stabiler React-Key). */
  key: string;
  /** Menschenlesbares Label (z.B. "Regel 100205"). */
  label: string;
  /** Ticket-Anzahl. */
  count: number;
}

const DEFAULT_TOP_N = 5;

/**
 * Humanisiert einen Rule-Key für die Anzeige.
 *  - "rule:100205"        → "Regel 100205"
 *  - "12345"              → "Regel 12345"   (reine QRadar-/Wazuh-ID)
 *  - "rule:100205:agent:x" → "Regel 100205" (Suffix wird ignoriert)
 *  - alles andere          → unverändert (ehrlich, keine Erfindung)
 */
export function humanizeRuleKey(key: string): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return '(unbekannt)';

  const ruleMatch = trimmed.match(/^rule:(\d+)/);
  if (ruleMatch) return `Regel ${ruleMatch[1]}`;

  if (/^\d+$/.test(trimmed)) return `Regel ${trimmed}`;

  return trimmed;
}

/**
 * Baut die anzeigefertigen Zeilen für die "Top Erkennungsquellen"-Card.
 *
 * - filtert Einträge mit count <= 0 (kein leerer Balken)
 * - sortiert absteigend nach count (stabil bei Gleichstand via Original-Reihenfolge)
 * - kappt auf topN (default 5)
 *
 * @param sources rohe topRules-Einträge (kann undefined/null sein → [])
 * @param topN    maximale Anzahl Zeilen (default 5)
 */
export function buildDetectionSources(
  sources: readonly DetectionSource[] | null | undefined,
  topN: number = DEFAULT_TOP_N,
): DetectionSourceRow[] {
  if (!sources || sources.length === 0) return [];

  const limit = Math.max(1, Math.floor(topN) || DEFAULT_TOP_N);

  return sources
    .filter((s) => Number.isFinite(s.count) && s.count > 0)
    .slice() // nicht in-place mutieren (Immutabilität)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((s) => ({ key: s.key, label: humanizeRuleKey(s.key), count: s.count }));
}
