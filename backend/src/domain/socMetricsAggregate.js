'use strict';

// P_STABILITY_2 · 3.3 — reine SOC-Metrik-Aggregation (aus SocMetricsService extrahiert,
// VERBATIM identische Logik). Wird vom InMemory-Repo (Dev/Test) und als Service-Fallback
// genutzt; der Postgres-Pfad aggregiert dieselben Kennzahlen serverseitig in SQL.
// Keine Seiteneffekte, keine I/O → voll testbar.

function aggregateTickets(tickets, { topN = 10, since = null } = {}) {
  const n = Math.max(1, Number(topN) || 10);
  // Zeitraumfilter (Audit #2): nur Tickets mit createdAt >= since. Ungültiges
  // `since` (kein parsebares Datum) wird ignoriert → All-Time (fail-open, aber
  // die Route validiert ohnehin vorab). Parität zum Postgres-`WHERE created_at`.
  const sinceMs = since != null && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;
  const scoped = sinceMs == null
    ? tickets
    : tickets.filter((t) => t.createdAt && Date.parse(t.createdAt) >= sinceMs);
  return {
    mttr:        calcMttr(scoped),
    fpRate:      calcFpRate(scoped),
    byState:     countBy(scoped, 'state'),
    byStatus:    countBy(scoped, 'status'),
    topRules:    topRules(scoped, n),
    analystLoad: analystLoad(scoped, n),
  };
}

// MTTR — Mean + Median Time To Resolve (ms). Basis: closedAt − createdAt (Audit #1),
// NICHT updatedAt (das springt bei jedem Edit). Tickets ohne closedAt zählen nicht mit.
function calcMttr(tickets) {
  const durations = tickets
    .filter((t) => t.state === 'CLOSED' && t.createdAt && t.closedAt)
    .map((t) => Date.parse(t.closedAt) - Date.parse(t.createdAt))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  if (durations.length === 0) return { meanMs: null, medianMs: null, sampleSize: 0 };

  const sum  = durations.reduce((acc, ms) => acc + ms, 0);
  const mean = sum / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return { meanMs: Math.round(mean), medianMs: Math.round(median), sampleSize: durations.length };
}

// FP-Rate — Anteil false_positive unter den KLASSIFIZIERT geschlossenen Tickets
// (Audit #3): Nenner = CLOSED mit nicht-leerem closeReason. Ein CLOSED-Ticket ohne
// Schliessgrund ist nicht klassifiziert und verzerrt die Rate sonst nach unten.
function calcFpRate(tickets) {
  const classified = tickets.filter((t) => t.state === 'CLOSED' && String(t.closeReason || '') !== '');
  if (classified.length === 0) return { rate: null, fpCount: 0, classifiedCount: 0 };
  const fpCount = classified.filter((t) => t.closeReason === 'false_positive').length;
  return { rate: fpCount / classified.length, fpCount, classifiedCount: classified.length };
}

// Zählung nach Feld; fehlende/leere Werte unter '_unset'.
function countBy(tickets, field) {
  const counts = {};
  for (const t of tickets) {
    const key = t[field] || '_unset';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Top-N Rules nach Häufigkeit (offenseId-Rule-Proxy).
function topRules(tickets, n) {
  const counts = {};
  for (const t of tickets) {
    const raw = String(t.offenseId || '').trim();
    if (!raw) continue;
    const key = extractRuleKey(raw);
    counts[key] = (counts[key] || 0) + 1;
  }
  return topEntries(counts, n);
}

// Last pro Analyst — nur aggregierte Zählwerte (Privacy), '_unassigned' ohne Analyst.
function analystLoad(tickets, n) {
  const load = {};
  for (const t of tickets) {
    const key = t.analyst || '_unassigned';
    if (!load[key]) load[key] = { analyst: key, total: 0, open: 0 };
    load[key].total += 1;
    if (t.state === 'OPEN') load[key].open += 1;
  }
  return Object.values(load).sort((a, b) => b.total - a.total).slice(0, n);
}

// "rule:100205:agent:win10" → "rule:100205"; QRadar "12345" → "12345".
function extractRuleKey(offenseId) {
  const m = offenseId.match(/^(rule:\d+)/);
  return m ? m[1] : offenseId;
}

function topEntries(counts, n) {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

module.exports = { aggregateTickets, calcMttr, calcFpRate, countBy, topRules, analystLoad };
