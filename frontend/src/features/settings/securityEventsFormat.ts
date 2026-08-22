// Reine Formatierungslogik für Security-relevante Audit-Events.
// ADR-009: Kein Fake-Wert — was nicht echt ist, wird nicht angezeigt.
// Kein JSX, kein DOM, kein IO — reine Mapping-Funktionen.

import type { AuditEntry } from '../audit/auditApi';

// ── Security-relevante Actions (Filter-Whitelist) ─────────────────────────────

export const SECURITY_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'USER_ACTIVE_CHANGE',
  'USER_PASSWORD_RESET',
  'USER_ROLE_CHANGE',
] as const;

export type SecurityAction = (typeof SECURITY_ACTIONS)[number];

// ── Typen ─────────────────────────────────────────────────────────────────────

export interface FormattedSecurityEvent {
  id: string;
  action: string;
  description: string;
  actor: string;
  createdAt: string;
  ip: string;
  isSuccess: boolean;
  metadata: Record<string, unknown>;
}

// ── Mapping: Action → Beschreibung + isSuccess ────────────────────────────────

interface ActionMeta {
  description: string;
  isSuccess: boolean;
}

const ACTION_MAP: Record<SecurityAction, ActionMeta> = {
  LOGIN:               { description: 'Anmeldung erfolgreich',              isSuccess: true  },
  LOGIN_FAILED:        { description: 'Anmeldung fehlgeschlagen',            isSuccess: false },
  USER_ACTIVE_CHANGE:  { description: 'Konto-Status geändert (gesperrt/aktiviert)', isSuccess: true  },
  USER_PASSWORD_RESET: { description: 'Passwort zurückgesetzt',              isSuccess: true  },
  USER_ROLE_CHANGE:    { description: 'Rolle / Berechtigungen geändert',     isSuccess: true  },
};

function isKnownSecurityAction(action: string): action is SecurityAction {
  return (SECURITY_ACTIONS as readonly string[]).includes(action);
}

// ── Öffentliche Funktionen ────────────────────────────────────────────────────

export function formatSecurityEvent(entry: AuditEntry): FormattedSecurityEvent {
  const meta: ActionMeta = isKnownSecurityAction(entry.action)
    ? ACTION_MAP[entry.action]
    : { description: entry.action, isSuccess: true };

  return {
    id:          entry.id,
    action:      entry.action,
    description: meta.description,
    actor:       entry.actorLabel,
    createdAt:   entry.createdAt,
    ip:          entry.ip,
    isSuccess:   meta.isSuccess,
    metadata:    entry.metadata,
  };
}

export function filterSecurityEvents(entries: AuditEntry[]): AuditEntry[] {
  return entries.filter((e) => isKnownSecurityAction(e.action));
}
