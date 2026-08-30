/**
 * KI-Analysefunktionen-Definitionen — reine, testbare Konstante.
 * Kein React, keine Side-Effects. Importierbar in Tests und Komponenten.
 */

import i18n from '../../../i18n';

export interface KiAnalysisFunction {
  /** Anzeigename im UI */
  label: string;
  /** Backend-Kind für agentApi.propose(ticketId, kind). undefined bei geplanten Funktionen. */
  kind?: string;
  /** true = Funktion verfügbar und propose-fähig; false = Platzhalter "folgt" */
  enabled: boolean;
  /** Kurze Beschreibung für den Tooltip */
  description: string;
}

/**
 * Geordnete Liste aller KI-Analysefunktionen.
 * Alle 9 aktiv (enabled=true).
 */
export const KI_ANALYSIS_FUNCTIONS: readonly KiAnalysisFunction[] = [
  {
    label: 'Triage Summary',
    kind: 'triage',
    enabled: true,
    description: i18n.t('analysis.createsStructuredAiTriageTicket'),
  },
  {
    label: 'False Positive Review',
    kind: 'false_positive_review',
    enabled: true,
    description: i18n.t('analysis.assessesWhetherCouldFalsePositive'),
  },
  {
    label: 'Incident Recommendation',
    kind: 'incident_recommendation',
    enabled: true,
    description: i18n.t('analysis.recommendsConcreteActionsIncident'),
  },
  {
    label: 'Threat Hunt Suggestion',
    kind: 'hunt_suggestion',
    enabled: true,
    description: i18n.t('analysis.suggestsThreatHuntScenariosBased'),
  },
  {
    label: 'Report Draft',
    kind: 'report_draft',
    enabled: true,
    description: i18n.t('analysis.createsDraftReportTicket'),
  },
  {
    label: 'Customer Response Draft',
    kind: 'customer_response',
    enabled: true,
    description: i18n.t('text.draftsCustomerReplyIncident'),
  },
  {
    label: 'Evidence Explanation',
    kind: 'evidence_explanation',
    enabled: true,
    description: i18n.t('analysis.explainsCollectedEvidenceIocsPlain'),
  },
  {
    label: 'MITRE Mapping',
    kind: 'mitre_mapping',
    enabled: true,
    description: i18n.t('analysis.mapsActivityMitreAttCk'),
  },
  {
    label: 'Next Steps',
    kind: 'next_steps',
    enabled: true,
    description: i18n.t('analysis.derivesPrioritisedConcreteNextAnalysis'),
  },
] as const;

/** Nur aktivierte Funktionen (propose-fähig). */
export function enabledKiFunctions(): readonly KiAnalysisFunction[] {
  return KI_ANALYSIS_FUNCTIONS.filter((f) => f.enabled);
}

/** Nur geplante (disabled) Funktionen. */
export function disabledKiFunctions(): readonly KiAnalysisFunction[] {
  return KI_ANALYSIS_FUNCTIONS.filter((f) => !f.enabled);
}
