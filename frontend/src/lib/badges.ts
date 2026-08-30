// Status-/Severity-Mapping → { label, tone } für die <Badge>-Komponente.

import type { Tone } from '../components/ui/Badge';
import i18n from '../i18n';

export interface BadgeSpec { label: string; tone: Tone; }

const SESSION_STATUS: Record<string, BadgeSpec> = {
  planned:   { label: i18n.t('common.planned'),       tone: 'muted' },
  active:    { label: i18n.t('common.active'),         tone: 'success' },
  completed: { label: 'Abgeschlossen', tone: 'accent' },
  failed:    { label: i18n.t('common.failed'), tone: 'danger' },
  cancelled: { label: 'Abgebrochen',   tone: 'muted' },
};

const COMMAND_STATUS: Record<string, BadgeSpec> = {
  queued:    { label: 'Queued',    tone: 'muted' },
  running:   { label: i18n.t('app.running'),     tone: 'accent' },
  completed: { label: 'Fertig',    tone: 'success' },
  failed:    { label: i18n.t('common.error'),    tone: 'danger' },
  blocked:   { label: i18n.t('text.blocked'), tone: 'warning' },
};

const SEVERITY: Record<string, BadgeSpec> = {
  critical: { label: 'Critical', tone: 'danger' },
  high:     { label: 'High',     tone: 'danger' },
  medium:   { label: 'Medium',   tone: 'warning' },
  low:      { label: 'Low',      tone: 'accent' },
  info:     { label: 'Info',     tone: 'muted' },
};

// State = Lifecycle (OPEN/CLOSED), Status = Workflow innerhalb OPEN.
const TICKET_STATE: Record<string, BadgeSpec> = {
  OPEN:   { label: 'Open',   tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'muted' },
};

const TICKET_STATUS: Record<string, BadgeSpec> = {
  assigned:          { label: 'Assigned',          tone: 'muted' },
  in_progress:       { label: 'In Progress',       tone: 'accent' },
  on_hold:           { label: 'On Hold',           tone: 'warning' },
  awaiting_customer: { label: 'Awaiting Customer',  tone: 'purple' },
};

const CLOSE_REASON: Record<string, BadgeSpec> = {
  resolved:       { label: 'Resolved',       tone: 'success' },
  false_positive: { label: 'False Positive', tone: 'muted' },
  duplicate:      { label: 'Duplicate',      tone: 'muted' },
  benign:         { label: 'Benign',         tone: 'muted' },
  other:          { label: 'Other',          tone: 'muted' },
};

const fallback = (v: string): BadgeSpec => ({ label: v || '—', tone: 'muted' });

export const badge = {
  sessionStatus: (v: string): BadgeSpec => SESSION_STATUS[v] ?? fallback(v),
  commandStatus: (v: string): BadgeSpec => COMMAND_STATUS[v] ?? fallback(v),
  severity:      (v: string): BadgeSpec => SEVERITY[v] ?? fallback(v),
  ticketState:   (v: string): BadgeSpec => TICKET_STATE[v] ?? fallback(v),
  ticketStatus:  (v: string): BadgeSpec => TICKET_STATUS[v] ?? fallback(v),
  closeReason:   (v: string): BadgeSpec => CLOSE_REASON[v] ?? fallback(v),
};
