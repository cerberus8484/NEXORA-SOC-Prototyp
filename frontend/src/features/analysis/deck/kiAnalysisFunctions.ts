/**
 * KI-Analysefunktionen-Definitionen — reine, testbare Konstante.
 * Kein React, keine Side-Effects. Importierbar in Tests und Komponenten.
 */

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
    description: 'Erstellt eine strukturierte KI-Triage für dieses Ticket.',
  },
  {
    label: 'False Positive Review',
    kind: 'false_positive_review',
    enabled: true,
    description: 'Bewertet, ob es sich um ein False Positive handeln könnte.',
  },
  {
    label: 'Incident Recommendation',
    kind: 'incident_recommendation',
    enabled: true,
    description: 'Empfiehlt konkrete Maßnahmen für diesen Vorfall.',
  },
  {
    label: 'Threat Hunt Suggestion',
    kind: 'hunt_suggestion',
    enabled: true,
    description: 'Schlägt Threat-Hunt-Szenarien basierend auf dem Kontext vor.',
  },
  {
    label: 'Report Draft',
    kind: 'report_draft',
    enabled: true,
    description: 'Erstellt einen Berichtsentwurf für dieses Ticket.',
  },
  {
    label: 'Customer Response Draft',
    kind: 'customer_response',
    enabled: true,
    description: 'Entwirft eine Kundenantwort zu diesem Vorfall.',
  },
  {
    label: 'Evidence Explanation',
    kind: 'evidence_explanation',
    enabled: true,
    description: 'Erklärt die gesammelten Evidenzen und IOCs verständlich für den Analysten.',
  },
  {
    label: 'MITRE Mapping',
    kind: 'mitre_mapping',
    enabled: true,
    description: 'Ordnet die Aktivität MITRE ATT&CK-Taktiken und -Techniken zu.',
  },
  {
    label: 'Next Steps',
    kind: 'next_steps',
    enabled: true,
    description: 'Leitet priorisierte, konkrete nächste Analyse-Schritte ab.',
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
