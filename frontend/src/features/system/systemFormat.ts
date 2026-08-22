// Reine Helfer für die System-Status-Graphen (Speicher + Aktivität) — testbar.

/** Bytes menschenlesbar (B/KB/MB/GB/TB, Basis 1024). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/** Werte → Balkenhöhen in px (anteilig am Maximum), min 1px für >0-Werte. */
export function barHeights(values: number[], maxPx: number): number[] {
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * maxPx))));
}
