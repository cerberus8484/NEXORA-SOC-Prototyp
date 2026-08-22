import type { QRadarOffense } from './qradarApi';

// Reine Abbildung QRadar-Offense → Nexora-Ticket-Draft (kein DOM, kein API) — testbar.
// QRadarPriority ist deckungsgleich mit den Ticket-Prioritäten (critical…info),
// daher 1:1. Quelle = 'qradar' (Backend-Enum). offenseId im selben Schema wie
// die Wazuh-Tickets: '<system>:offense:<id>'.

export type QRadarTicketDraft = Record<string, unknown>;

/** Baut das Roh-/Log-Feld mit den QRadar-Scores + Kontext (landet im Ticket-`logs`). */
function buildLogSummary(o: QRadarOffense): string {
  return [
    `QRadar Offense #${o.id} — ${o.offenseName}`,
    `Scores: Severity ${o.severity}/10 · Credibility ${o.credibility}/10 · Relevance ${o.relevance}/10 · Magnitude ${o.magnitude}/10`,
    `Events: ${o.eventCount} · Flows: ${o.flowCount} · Sources: ${o.sourceCount}`,
    o.logSources.length ? `Log Sources: ${o.logSources.join(', ')}` : '',
    o.sourceIps.length ? `Source IPs: ${o.sourceIps.join(', ')}` : '',
    o.destIps.length ? `Destination IPs: ${o.destIps.join(', ')}` : '',
    o.categories.length ? `Categories: ${o.categories.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export interface OffenseToTicketOptions {
  /** True → Ticket wird direkt als False Positive geschlossen (state CLOSED, Grund false_positive). */
  asFalsePositive?: boolean;
}

/**
 * QRadar-Offense → Ticket-Draft fürs Backend (`POST /v1/tickets`).
 * Die Nummer (INC…) vergibt das Backend; offenseId macht den Ursprung nachvollziehbar.
 */
export function offenseToTicketDraft(o: QRadarOffense, opts: OffenseToTicketOptions = {}): QRadarTicketDraft {
  const draft: QRadarTicketDraft = {
    title: o.offenseName,
    offenseId: `qradar:offense:${o.id}`,
    source: 'qradar',
    priority: o.priority,
    category: o.categories.join(', '),
    description: o.description,
    srcIp: o.sourceIps[0] ?? '',
    dstIp: o.destIps[0] ?? '',
    mitre: o.mitreT.join(', '),
    datetime: o.startTime,
    logs: buildLogSummary(o),
  };

  if (opts.asFalsePositive) {
    return { ...draft, state: 'CLOSED', closeReason: 'false_positive', decision: 'fp' };
  }
  return draft;
}
