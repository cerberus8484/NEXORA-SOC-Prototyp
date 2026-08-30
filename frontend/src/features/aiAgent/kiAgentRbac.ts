/**
 * RBAC-Matrix für KI-Aktionen — reine, testbare Definitionen.
 * Kein React, keine Side-Effects. Spiegelt Backend-Rollen (authenticate.js):
 * admin > engineer > analyst > viewer.
 *
 * Hinweis: Durchsetzung erfolgt serverseitig. Diese Datei ist read-only Anzeige.
 */
import { hasRole, type Role } from '../../lib/rbac';
import i18n from '../../i18n';

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
    label: i18n.t('analysis.requestAiAnalysis'),
    description: i18n.t('app.startsAiAnalysisTicketPropose'),
  },
  {
    action: 'approve',
    minRole: 'analyst',
    label: i18n.t('analysis.approveSuggestion'),
    description: i18n.t('text.approvesAiSuggestionAnalystEngineer'),
  },
  {
    action: 'reject',
    minRole: 'analyst',
    label: i18n.t('analysis.rejectSuggestion'),
    description: i18n.t('app.rejectsAiSuggestionJustificationAnalyst'),
  },
  {
    action: 'configure',
    minRole: 'admin',
    label: i18n.t('settings.aiConfiguration'),
    description: i18n.t('app.changesProviderModelRagOther'),
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
