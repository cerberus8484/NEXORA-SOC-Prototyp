// Ticket-Historie: Audit-Einträge in Anzeige-Form übersetzen (pure, testbar).

import i18n from '../../i18n';

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export type HistoryTone = 'success' | 'accent' | 'danger' | 'warning' | 'muted';

export interface HistoryDisplay {
  label: string;
  tone: HistoryTone;
  detail: string;
}

const ACTION_MAP: Record<string, { label: string; tone: HistoryTone }> = {
  TICKET_CREATE: { label: i18n.t('audit.ticketCreated'), tone: 'success' },
  TICKET_UPDATE: { label: i18n.t('audit.ticketUpdated'), tone: 'accent' },
  TICKET_DELETE: { label: i18n.t('settings.ticketDeleted'), tone: 'danger' },
  TICKET_VIEW: { label: 'Ticket angesehen', tone: 'muted' },
  AGENT_SUGGESTION_APPROVE: { label: i18n.t('audit.aiSuggestionApproved'), tone: 'success' },
  AGENT_SUGGESTION_REJECT: { label: i18n.t('audit.aiSuggestionRejected'), tone: 'warning' },
};

// Feld-IDs → lesbare Labels (nur die, die Analysten wirklich ändern).
const FIELD_LABEL: Record<string, string> = {
  state: 'State', status: 'Status', priority: i18n.t('common.priority'), analyst: 'Analyst',
  decision: 'Decision', confidence: 'Confidence', recommendation: i18n.t('common.recommendation'),
  notes: 'Notizen', title: 'Titel', description: i18n.t('common.description'), iocs: 'IoCs',
  closeReason: i18n.t('analysis.closingReason'), customer: 'Kunde',
};

/** Audit-Eintrag → Anzeige (Label, Farbe, Detailtext mit geänderten Feldern). */
export function describeAuditEntry(e: AuditEntry): HistoryDisplay {
  const base = ACTION_MAP[e.action] ?? { label: e.action || 'Aktion', tone: 'muted' as HistoryTone };
  let detail = '';
  if (e.action === 'TICKET_UPDATE') {
    const fields = Array.isArray(e.metadata?.fields) ? (e.metadata.fields as string[]) : [];
    if (fields.length) detail = fields.map((f) => FIELD_LABEL[f] ?? f).join(', ');
  }
  return { ...base, detail };
}

/** Geänderte Felder eines Eintrags (Roh-IDs) — leer wenn keine. */
export function changedFields(e: AuditEntry): string[] {
  return Array.isArray(e.metadata?.fields) ? (e.metadata.fields as string[]) : [];
}
/** Lesbare Labels der geänderten Felder. */
export function changedFieldLabels(e: AuditEntry): string[] {
  return changedFields(e).map((f) => FIELD_LABEL[f] ?? f);
}

// ── Kategorie (für Badges + Filter) ───────────────────────────────────────────
export interface CategoryMeta { key: string; label: string; tone: HistoryTone }
export function auditCategory(e: AuditEntry): CategoryMeta {
  if (e.action.startsWith('AGENT_')) return { key: 'analysis', label: 'Analysis', tone: 'accent' };
  if (e.action === 'TICKET_CREATE') return { key: 'system', label: 'System', tone: 'muted' };
  if (e.action === 'TICKET_DELETE') return { key: 'system', label: 'System', tone: 'danger' };
  if (e.action === 'TICKET_UPDATE') {
    const f = changedFields(e);
    if (f.includes('decision')) return { key: 'decision', label: 'Decision', tone: 'success' };
    if (f.includes('status') || f.includes('state') || f.includes('closeReason')) return { key: 'status', label: 'Status', tone: 'accent' };
    if (f.includes('notes')) return { key: 'note', label: 'Note', tone: 'accent' };
    return { key: 'update', label: 'Update', tone: 'muted' };
  }
  return { key: 'system', label: 'System', tone: 'muted' };
}

// ── Activity Summary (Zählungen) ──────────────────────────────────────────────
export interface ActivitySummary { total: number; analyst: number; system: number; automation: number }
export function activitySummary(entries: AuditEntry[]): ActivitySummary {
  let analyst = 0, system = 0, automation = 0;
  for (const e of entries) {
    if (e.action.startsWith('AGENT_')) automation += 1;
    else if (e.actorUserId) analyst += 1;
    else system += 1;
  }
  return { total: entries.length, analyst, system, automation };
}

// ── Decision-/Status-Verlauf (für Decision Timeline) ──────────────────────────
export function decisionEntries(entries: AuditEntry[]): AuditEntry[] {
  return entries.filter((e) => {
    const f = changedFields(e);
    return e.action === 'TICKET_CREATE' || f.includes('decision') || f.includes('status') || f.includes('state');
  });
}

// ── Revisionen (aus feldändernden Updates + Erstellung) ───────────────────────
export interface RevisionRow { id: string; at: string; by: string; changes: string; version: string }
export function revisions(entries: AuditEntry[]): RevisionRow[] {
  // chronologisch (älteste zuerst) für Versionsnummerierung
  const relevant = [...entries]
    .filter((e) => e.action === 'TICKET_CREATE' || (e.action === 'TICKET_UPDATE' && changedFields(e).length > 0))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return relevant.map((e, i) => ({
    id: e.id,
    at: e.createdAt,
    by: e.actorLabel || 'System',
    changes: e.action === 'TICKET_CREATE' ? 'Erstanlage' : (changedFieldLabels(e).join(', ') || i18n.t('common.update')),
    version: e.action === 'TICKET_CREATE' ? 'v1.0' : `v1.${i}`,
  })).reverse(); // neueste zuerst
}
