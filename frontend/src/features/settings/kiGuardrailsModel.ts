// Reine Formatierungs-Helfer für die KI-Settings-Welle-2-Sektionen
// (Guardrails-Transparenz + Nutzungsmetriken). Keine React-/DOM-Abhängigkeit → isoliert testbar.

/** Latenz menschlich: < 1000 ms → "850 ms", sonst Sekunden "14.2 s". */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Kosten-Schätzung: 0 → "$0.00", < 0.01 → "< $0.01", sonst "$x.xx". */
export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

/** Tokens kompakt: 1234 → "1.2k", 999 → "999", 0 → "0". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}k`;
}

/** Fehlerrate in ganzen Prozent (0 bei 0 Calls). */
export function errorRatePct(calls: number, errors: number): number {
  if (!calls || calls <= 0) return 0;
  return Math.round((errors / calls) * 100);
}
