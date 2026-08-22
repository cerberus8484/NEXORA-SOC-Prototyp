// Reine Datenstruktur — keine UI, keine Side-Effects.
// Spiegelt die echte RBAC-Hierarchie aus lib/rbac.ts:
//   admin (4) > engineer (3) > analyst (2) > viewer (1)
//
// Jede Berechtigung entspricht einer echten Backend-Schranke.
// Nicht erfunden — aus Backend-Middleware und Feature-Code abgeleitet.

import type { ManagedUser } from './userMgmtModel';

export type RoleName = 'viewer' | 'analyst' | 'engineer' | 'admin';

export interface PermissionRow {
  /** Tickets/Hunts/Analyse lesen */
  readTickets: boolean;
  /** Ticket anlegen, Lifecycle-Aktionen (Kommentare, Status) */
  createTicket: boolean;
  /** Threat Hunts starten und verwalten */
  runHunts: boolean;
  /** KI-Analyse erzeugen (AgentService.propose) */
  generateAiAnalysis: boolean;
  /** Weitergeleiteten FP-Vorschlag anwenden (engineer+) */
  applyFpException: boolean;
  /** Benutzer & Einstellungen verwalten (admin only) */
  manageSettings: boolean;
  /** KI-Agent-Vorschläge genehmigen / ablehnen (admin only) */
  approveAiSuggestions: boolean;
}

/**
 * Statische Berechtigungs-Matrix.
 * Ändert sich nur, wenn sich das Backend-RBAC ändert — dann BEIDE anpassen.
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleName, PermissionRow> = {
  viewer: {
    readTickets:        true,
    createTicket:       false,
    runHunts:           false,
    generateAiAnalysis: false,
    applyFpException:   false,
    manageSettings:     false,
    approveAiSuggestions: false,
  },
  analyst: {
    readTickets:        true,
    createTicket:       true,
    runHunts:           true,
    generateAiAnalysis: true,
    applyFpException:   false,
    manageSettings:     false,
    approveAiSuggestions: false,
  },
  engineer: {
    readTickets:        true,
    createTicket:       true,
    runHunts:           true,
    generateAiAnalysis: true,
    applyFpException:   true,
    manageSettings:     false,
    approveAiSuggestions: false,
  },
  admin: {
    readTickets:        true,
    createTicket:       true,
    runHunts:           true,
    generateAiAnalysis: true,
    applyFpException:   true,
    manageSettings:     true,
    approveAiSuggestions: true,
  },
};

/** Deutsches Label für jede Berechtigung (für die Matrix-Tabelle). */
export const PERMISSION_LABELS: Record<keyof PermissionRow, string> = {
  readTickets:          'Tickets & Hunts lesen',
  createTicket:         'Ticket anlegen & bearbeiten',
  runHunts:             'Hunts starten',
  generateAiAnalysis:   'KI-Analyse erzeugen',
  applyFpException:     'FP-Ausnahme anwenden',
  manageSettings:       'Einstellungen & Benutzer verwalten',
  approveAiSuggestions: 'KI-Vorschläge genehmigen',
};

/**
 * Gibt zurück, ob eine Rolle eine bestimmte Berechtigung hat.
 * Unbekannte Rollen liefern false (kein Crash).
 */
export function hasPermission(role: RoleName, permission: keyof PermissionRow): boolean {
  return ROLE_PERMISSION_MATRIX[role]?.[permission] ?? false;
}

/**
 * Zählt Benutzer je Rolle aus der übergebenen Liste.
 * Zählt inaktive mit — widerspiegelt die tatsächliche Rollen-Verteilung.
 */
export function getRoleCounts(users: ManagedUser[]): Record<RoleName, number> {
  const counts: Record<RoleName, number> = { viewer: 0, analyst: 0, engineer: 0, admin: 0 };
  for (const u of users) {
    if (u.role in counts) {
      counts[u.role as RoleName] += 1;
    }
  }
  return counts;
}
