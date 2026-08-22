// Reine Mapping-Funktion: Audit-Eintrag → lesbare Beschreibung.
// Kein API-Call, kein State — vollständig testbar.

import type { AuditEntry } from '../audit/auditApi';

/** Die 4 Benutzer-bezogenen Audit-Aktionen, die der Feed anzeigt. */
export const USER_AUDIT_ACTIONS = [
  'USER_CREATED',
  'USER_ROLE_CHANGE',
  'USER_ACTIVE_CHANGE',
  'USER_PASSWORD_RESET',
] as const;

export type UserAuditAction = (typeof USER_AUDIT_ACTIONS)[number];

/** Ergebnis der Formatierung — enthält alles, was die UI zum Rendern braucht. */
export interface FormattedUserAuditEntry {
  description: string;
  actorLabel: string;
  createdAt: string;
}

/**
 * AuditEntry liegt als Rohtyp aus der API vor (alle Felder optional-safe via
 * optionaler Verkettung), daher dieselbe Signatur wie AuditEntry aus auditApi.ts.
 */
export type UserAuditEntry = AuditEntry;

function extractEmail(metadata: Record<string, unknown>): string {
  const email = metadata['email'];
  return typeof email === 'string' && email.length > 0 ? email : '(unbekannt)';
}

function extractString(metadata: Record<string, unknown>, key: string): string {
  const val = metadata[key];
  return typeof val === 'string' && val.length > 0 ? val : '–';
}

/**
 * Wandelt einen Audit-Eintrag in eine für die UI lesbare Beschreibung um.
 * Fallback bei unbekannter action: zeigt die action selbst an — kein Crash.
 */
export function formatUserAuditEntry(entry: UserAuditEntry): FormattedUserAuditEntry {
  const meta = entry.metadata ?? {};
  const email = extractEmail(meta);

  let description: string;

  switch (entry.action) {
    case 'USER_CREATED':
      description = `Benutzer angelegt: ${email}`;
      break;

    case 'USER_ROLE_CHANGE': {
      const from = extractString(meta, 'fromRole');
      const to   = extractString(meta, 'toRole');
      description = `Rolle geändert: ${email} — ${from} → ${to}`;
      break;
    }

    case 'USER_ACTIVE_CHANGE': {
      const isActive = meta['isActive'];
      const state = isActive === true ? 'aktiviert' : 'deaktiviert';
      description = `Benutzer ${state}: ${email}`;
      break;
    }

    case 'USER_PASSWORD_RESET':
      description = `Passwort zurückgesetzt: ${email}`;
      break;

    default:
      description = `Ereignis: ${entry.action}`;
      break;
  }

  return {
    description,
    actorLabel: entry.actorLabel ?? '(System)',
    createdAt:  entry.createdAt,
  };
}
