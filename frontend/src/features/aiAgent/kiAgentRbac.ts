/**
 * RBAC-Matrix für KI-Aktionen — reine, testbare Definitionen.
 * Kein React, keine Side-Effects. Spiegelt Backend-Rollen (authenticate.js):
 * admin > engineer > analyst > viewer.
 *
 * Hinweis: Durchsetzung erfolgt serverseitig. Diese Datei ist read-only Anzeige.
 */
import { hasRole, type Role } from '../../lib/rbac';

export interface KiActionRbacRow {
  /** Technische Aktion */
  action: 'propose' | 'approve' | 'reject' | 'configure';
  /** Mindest-Rolle für diese Aktion */
  minRole: Role;
  /** Anzeigename im UI */
  label: string;
  /** Kurze Erklärung */
  description: string;
}

/**
 * Geordnete RBAC-Matrix für KI-Aktionen.
 * Basiert auf Backend-Logik: analyst+ für propose/approve/reject, admin für configure.
 */
export const KI_ACTION_RBAC: readonly KiActionRbacRow[] = [
  {
    action: 'propose',
    minRole: 'analyst',
    label: 'KI-Analyse anfordern',
    description: 'Startet eine KI-Analyse für ein Ticket (propose). Analyst, Engineer, Admin.',
  },
  {
    action: 'approve',
    minRole: 'analyst',
    label: 'Vorschlag genehmigen',
    description: 'Genehmigt einen KI-Vorschlag. Analyst, Engineer, Admin.',
  },
  {
    action: 'reject',
    minRole: 'analyst',
    label: 'Vorschlag ablehnen',
    description: 'Lehnt einen KI-Vorschlag ab (mit Begründung). Analyst, Engineer, Admin.',
  },
  {
    action: 'configure',
    minRole: 'admin',
    label: 'KI-Konfiguration',
    description: 'Ändert Provider, Modell, RAG und weitere KI-Einstellungen. Nur Admin.',
  },
] as const;

/** Darf der Nutzer KI-Analysen anfordern? */
export function canProposeKi(role: string | undefined): boolean {
  return hasRole(role, 'analyst');
}

/** Darf der Nutzer KI-Vorschläge genehmigen? */
export function canApproveKi(role: string | undefined): boolean {
  return hasRole(role, 'analyst');
}

/** Darf der Nutzer KI-Vorschläge ablehnen? */
export function canRejectKi(role: string | undefined): boolean {
  return hasRole(role, 'analyst');
}

/** Darf der Nutzer die KI-Konfiguration ändern? */
export function canConfigureKi(role: string | undefined): boolean {
  return hasRole(role, 'admin');
}
