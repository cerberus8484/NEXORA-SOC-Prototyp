// Strukturierte Report-Modelle (rein, testbar) — Single Source für Preview/Print/Text/PDF.
// Zwei Perspektiven aus DENSELBEN Ticket-Daten:
//   - Incident-Report  → technisch, evidence-gradiert (P_REPORTS_1)
//   - Kunden-Report    → nicht-technisch, KEIN IP/MITRE/IOC/Raw-Leak
//
// Evidence-Gradierung (P_REPORTS_1): jede Aussage ist genau einem Bereich zugeordnet —
// bestätigte Fakten · auffällige Indikatoren · fehlende Evidence · Analystenbewertung ·
// Maßnahmen · Traceability. Indikatoren werden NIE als bestätigte Fakten formuliert.
// ADR-009 bleibt gültig: fehlende Werte werden ausgelassen, nichts erfunden.

import type { Ticket } from '../../lib/types';
import type { SummaryBullet, BulletKind, EntityItem } from './deckModel';
import type {
  TicketTimeline, Ioc, NetworkCorrelation, CorrelationJobStatus, ParsedEvidence,
} from './analysisModel';
import { classifyIoc } from './analysisModel';
import i18n from '../../i18n';

export type ReportSectionCategory =
  | 'facts' | 'indicators' | 'gaps' | 'assessment' | 'actions' | 'traceability' | 'meta';

export interface ReportField { label: string; value: string; source?: string; }
/** Gradierte Aussage mit optionaler Quellen-Referenz (Traceability). */
export interface ReportItem { text: string; source?: string; }
export interface ReportSection {
  category?: ReportSectionCategory;
  heading: string;
  fields?: ReportField[];
  items?: ReportItem[];
  bullets?: string[];
  paragraphs?: string[];
}
export interface ReportDoc {
  kind: 'incident' | 'customer';
  title: string;
  subtitle: string;
  sections: ReportSection[];
}

/** Eingaben für den Incident-Report — alles außer ticket optional (ADR-009: fehlt → ausgelassen). */
export interface IncidentReportInput {
  ticket: Ticket;
  summary?: SummaryBullet[];
  entities?: EntityItem[];
  timeline?: TicketTimeline | null;
  iocs?: Ioc[];
  network?: NetworkCorrelation | null;
  correlation?: { status: CorrelationJobStatus; resultCreatedAt: string | null } | null;
  evidence?: ParsedEvidence | null;
}

// SummaryBullet-Kinds → gradierte Bereiche (Wiederverwendung der bestehenden Ableitung).
const FACT_BULLET_KINDS = new Set<BulletKind>(['process', 'decoded', 'network', 'data']);

const PRIORITY_LABEL_KEYS: Record<string, string> = {
  critical: 'common.critical', high: 'tickets.priorities.high', medium: 'tickets.priorities.medium', low: 'tickets.priorities.low', info: 'common.information',
};

export function priorityLabel(priority: string): string {
  const key = PRIORITY_LABEL_KEYS[priority];
  return key ? i18n.t(key) : priority;
}
const CUSTOMER_STATUS_KEYS: Record<string, string> = {
  open: 'tickets.inProgress', progress: 'tickets.inProgress', closed: 'tickets.closed',
  fp: 'text.notSecurityIncidentFalseAlarm',
};

export function customerStatusLabel(status: string): string {
  const key = CUSTOMER_STATUS_KEYS[status];
  return key ? i18n.t(key) : status;
}

function field(label: string, value?: string | null, source?: string): ReportField | null {
  const v = (value ?? '').toString().trim();
  if (!v) return null;
  return source ? { label, value: v, source } : { label, value: v };
}
function fields(...xs: (ReportField | null)[]): ReportField[] {
  return xs.filter((f): f is ReportField => f !== null);
}
function item(text?: string | null, source?: string): ReportItem | null {
  const t = (text ?? '').toString().trim();
  if (!t) return null;
  return source ? { text: t, source } : { text: t };
}
function items(...xs: (ReportItem | null)[]): ReportItem[] {
  return xs.filter((x): x is ReportItem => x !== null);
}
/** Nicht-leere Zeilen aus einem mehrzeiligen Feld (z. B. ticket.actions). */
function lines(text?: string | null): string[] {
  return (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Ticket-IoCs aus Freitext ableiten (reuse classifyIoc) — wenn der Caller keine iocs liefert. */
function ticketIocs(t: Ticket): Ioc[] {
  return (t.iocs ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
    .map((value) => ({ type: classifyIoc(value), value }));
}

/**
 * Evidence-gradierter Incident-Report aus den echten Deck-Daten.
 * Sechs klar getrennte Bereiche; leere Bereiche werden ausgelassen (kein Fake-Inhalt).
 */
export function buildIncidentReport(input: IncidentReportInput): ReportDoc {
  const { ticket: t } = input;
  const summary = input.summary ?? [];
  const entities = input.entities ?? [];
  const tl = input.timeline ?? null;
  const network = input.network ?? null;
  const id = t.ticketNr || t.id;
  const sections: ReportSection[] = [];

  // ── 1. Bestätigte Fakten ──────────────────────────────────────────────────
  const factBullets = summary.filter((b) => FACT_BULLET_KINDS.has(b.kind));
  const factItems = items(
    ...factBullets.map((b) => item(b.text, 'Evidence')),
    network?.flows?.length ? item(`${network.flows.length} korrelierte Network-Flows`, 'Network-Korrelation') : null,
    input.correlation?.status === 'current'
      ? item(`Korrelation aktuell${input.correlation.resultCreatedAt ? ` (Stand ${input.correlation.resultCreatedAt})` : ''}`, 'Correlation')
      : null,
  );
  sections.push({
    category: 'facts',
    heading: i18n.t('analysis.confirmedFacts'),
    fields: fields(
      field('Ticket', id, 'Ticket'),
      field('Titel', t.title, 'Ticket'),
      field(i18n.t('common.priority'), t.priority, 'Ticket'),
      field('State', t.state ?? 'OPEN', 'Ticket'),
      field('Status', t.status, 'Ticket'),
      field(i18n.t('common.source'), t.source || 'manual', 'Ticket'),
      field('Zeitpunkt', t.datetime, 'Ticket'),
      field('Kunde', t.customer, 'Ticket'),
      field('Analyst', t.analyst, 'Ticket'),
    ),
    items: factItems,
  });

  // ── 2. Auffällige Indikatoren (NIE als Fakt) ─────────────────────────────
  const iocList = (input.iocs && input.iocs.length ? input.iocs : ticketIocs(t));
  const c2Bullets = summary.filter((b) => b.kind === 'c2');
  const mitre = (t.mitre || input.evidence?.metadata.mitreTechnique || '').trim();
  const indicatorItems = items(
    mitre ? item(`MITRE-Technik: ${input.evidence?.metadata.mitreTactic ? `${input.evidence.metadata.mitreTactic} · ` : ''}${mitre}`, 'Ticket/Evidence') : null,
    ...iocList.map((ioc) => item(
      `${ioc.type.toUpperCase()}: ${ioc.value}${ioc.reputation && ioc.reputation !== 'unknown' ? ` (${ioc.reputation})` : ''}`,
      'IOC',
    )),
    ...c2Bullets.map((b) => item(b.text, 'Evidence (Interpretation)')),
  );
  if (indicatorItems.length) {
    sections.push({ category: 'indicators', heading: i18n.t('analysis.notableIndicators'), items: indicatorItems });
  }

  // ── 3. Fehlende Evidence / offene Fragen (nur bei echten Lücken) ──────────
  const infoBullets = summary.filter((b) => b.kind === 'info');
  const gapItems = items(
    ...(network?.gaps ?? []).map((g) => item(
      `${g.field}: ${g.missingReason}${g.count > 1 ? ` (×${g.count})` : ''}`, 'Network-Korrelation',
    )),
    ...infoBullets.map((b) => item(b.text, 'Evidence')),
  );
  if (gapItems.length) {
    sections.push({ category: 'gaps', heading: 'Fehlende Evidence / offene Fragen', items: gapItems });
  }

  // ── 4. Analystenbewertung (klar als Bewertung markiert) ──────────────────
  const assessmentItems = items(
    item(t.decision ? i18n.t('analysis.analystClassification', { decision: t.decision }) : null, 'Analyst'),
  );
  if (assessmentItems.length) {
    sections.push({
      category: 'assessment',
      heading: i18n.t('analysis.analystAssessment'),
      paragraphs: [i18n.t('analysis.analystAssessmentNotConfirmedFact')],
      items: assessmentItems,
    });
  }

  // ── 5. Maßnahmen & Empfehlungen (nur aus echten Ticket-Daten) ────────────
  const recommendBullets = summary.filter((b) => b.kind === 'recommend');
  const actionItems = items(
    ...lines(t.actions).map((l) => item(l, 'Ticket-Actions')),
    ...lines(t.recommendation).map((l) => item(l, i18n.t('analysis.ticketRecommendation'))),
    ...recommendBullets.map((b) => item(b.text, 'Evidence')),
  );
  if (actionItems.length) {
    sections.push({ category: 'actions', heading: i18n.t('analysis.actionsRecommendations'), items: actionItems });
  }

  // ── 6. Traceability — woraus stammt der Report ───────────────────────────
  const traceItems = items(
    item(`Ticket: ${id}`, 'Ticket'),
    input.evidence ? item(i18n.t('analysis.evidenceSourceOf', { source: input.evidence.metadata.agentName || input.evidence.detection.sourceSystem || input.evidence.type }), 'Evidence') : null,
    input.correlation ? item(`Korrelation: ${input.correlation.status}${input.correlation.resultCreatedAt ? ` · Stand ${input.correlation.resultCreatedAt}` : ''}`, 'Correlation') : null,
    tl && tl.events.length ? item(`Timeline: ${tl.events.length} Events`, 'Timeline') : null,
    network?.flows?.length ? item(`Network-Flows: ${network.flows.length}`, 'Network-Korrelation') : null,
    entities.length ? item(`Entities: ${entities.length}`, 'Deck') : null,
  );
  sections.push({ category: 'traceability', heading: i18n.t('analysis.traceabilitySources'), items: traceItems });

  return { kind: 'incident', title: 'Incident-Report', subtitle: `${id} · ${t.title || ''}`.trim(), sections };
}

/** Nicht-technischer Kunden-Report — bewusst OHNE IPs/MITRE/IOCs/Raw-Timeline. */
export function buildCustomerReport(t: Ticket, bullets: SummaryBullet[]): ReportDoc {
  const id = t.ticketNr || t.id;
  const sections: ReportSection[] = [];

  const summary = lines(t.description);
  sections.push({
    category: 'meta',
    heading: i18n.t('common.summary'),
    paragraphs: summary.length ? summary : [t.title || i18n.t('analysis.securityRelevantEventHasBeen')],
  });

  sections.push({
    category: 'meta',
    heading: i18n.t('common.classification'),
    fields: fields(
      field('Schweregrad', priorityLabel(t.priority)),
      field('Bearbeitungsstatus', customerStatusLabel(t.status)),
    ),
  });

  const actions = lines(t.actions);
  if (actions.length) {
    sections.push({ category: 'meta', heading: i18n.t('analysis.actionsTaken'), bullets: actions });
  }

  if ((t.recommendation ?? '').trim()) {
    sections.push({ category: 'meta', heading: i18n.t('common.recommendation'), paragraphs: lines(t.recommendation) });
  }

  // Bewusst keine technischen Bullets/Entities/IPs — nur kuratierte Felder.
  void bullets;

  return { kind: 'customer', title: 'Sicherheitsbericht', subtitle: `${id} · ${t.title || ''}`.trim(), sections };
}
