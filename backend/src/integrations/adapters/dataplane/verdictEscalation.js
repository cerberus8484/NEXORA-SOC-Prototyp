'use strict';

// Entscheidet, ob ein bereits angelegter Data-Plane-Vorfall durch eine spätere,
// reichere Cross-Domain-Re-Fusion HOCHGESTUFT werden soll (ADR-035 §8).
// Reine Funktion → testbar, keine Seiteneffekte. Die A4-Ingress bleibt idempotent:
// gleicher/niedrigerer Vorfall = kein Update; nur ein echter Anstieg aktualisiert.

const PRIORITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
// decision = Verdikt-Abbildung (ticketSchema): '' (observed) < suspicious < incident (confirmed_malicious).
const DECISION_RANK = { '': 0, suspicious: 1, incident: 2 };
// Vom Analysten gesetzte Endurteile — NIE automatisch überschreiben.
const ANALYST_FINAL = new Set(['benign', 'fp']);

function prioRank(p) { return PRIORITY_RANK[p] !== undefined ? PRIORITY_RANK[p] : 0; }
function decRank(d) { return DECISION_RANK[d] !== undefined ? DECISION_RANK[d] : 0; }

/**
 * @param {{ priority?:string, decision?:string }} existing  aktuelles Ticket
 * @param {{ priority?:string, decision?:string }} incoming  neuer (normalisierter) Vorfall
 * @returns {boolean} true, wenn das Ticket hochgestuft werden soll
 */
function shouldEscalate(existing, incoming) {
  if (!existing || !incoming) return false;
  if (ANALYST_FINAL.has(existing.decision)) return false;      // Analyst-Urteil respektieren
  if (prioRank(incoming.priority) > prioRank(existing.priority)) return true;
  if (decRank(incoming.decision) > decRank(existing.decision)) return true;
  return false;
}

module.exports = { shouldEscalate, PRIORITY_RANK, DECISION_RANK, ANALYST_FINAL };
