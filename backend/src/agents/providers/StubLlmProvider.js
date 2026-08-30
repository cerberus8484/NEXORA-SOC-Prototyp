'use strict';

const { LlmProvider } = require('./LlmProvider');

// Severity → Basis-Confidence (deterministisch, erklärbar).
const SEVERITY_CONFIDENCE = { critical: 0.9, high: 0.75, medium: 0.55, low: 0.35, info: 0.2 };

// Vorschlagstext je Art + Severity-Klasse.
const PROPOSAL = {
  triage: (sev) => sev === 'critical' || sev === 'high'
    ? 'Als bestätigten Incident eskalieren und Host isolieren'
    : 'Als wahrscheinlichen False Positive einstufen, Beobachtung dokumentieren',
  action: () => 'Empfohlene Sofortmaßnahme: betroffenen Account-Login sperren und Sitzung beenden',
  enrichment: () => 'Threat-Intel-Lookup für enthaltene IOCs (Hash/IP/Domain) anstoßen',
  // KI-Analyse-Tab — deterministisch, erklärbar, je Kind distinkt:
  evidence_explanation: (sev) => sev === 'critical' || sev === 'high'
    ? 'Vorliegende Evidence zeigt erhöhtes Risikopotenzial: IOCs und Alert-Kontext deuten auf eine aktive Bedrohung hin — vollständige Beweissicherung empfohlen.'
    : 'Vorliegende Evidence ist schwach oder mehrdeutig: Kontext und Logs sollten vor einer Einstufung ergänzt werden.',
  mitre_mapping: (sev) => sev === 'critical' || sev === 'high'
    ? 'Taktik: Execution / Persistence (T1059 Command and Scripting Interpreter, T1547 Boot/Logon Autostart) — Schweregrad und Kontext legen aktive Post-Exploitation nahe.'
    : 'Taktik: Discovery / Defense Evasion (T1082 System Information Discovery) — Aktivität passt zu Aufklärung oder Rauschsignal.',
  next_steps: (sev) => sev === 'critical' || sev === 'high'
    ? '1. Host sofort isolieren und forensische Kopie sichern. 2. Lateral-Movement-Pfade prüfen (Logins, Netzwerkverbindungen). 3. Incident-Response-Prozess eskalieren.'
    : '1. Alert mit bekannten Baselines abgleichen. 2. Ursprünglichen Log-Eintrag und Regel-Kontext prüfen. 3. Beobachtung dokumentieren, 24h weiterbeobachten.',
};

/**
 * StubLlmProvider — deterministischer Platzhalter ohne echtes LLM.
 *
 * Erzeugt nachvollziehbare Vorschläge anhand der Ticket-Severity. Dient als
 * Default in Tests/Dev und als Fallback, solange kein lokales Modell (Ollama)
 * angebunden ist. Niemals zufällig → Tests bleiben stabil.
 */
class StubLlmProvider extends LlmProvider {
  constructor() {
    super();
    this.name = 'stub-llm-v1';
  }

  async propose({ ticket, kind = 'triage' }) {
    const sev = String(ticket?.severity || ticket?.priority || 'medium').toLowerCase();
    const base = SEVERITY_CONFIDENCE[sev] ?? 0.5;
    const proposalFn = PROPOSAL[kind] || PROPOSAL.triage;
    const verdict = kind === 'false_positive_review'
      ? 'false_positive'
      : kind === 'triage'
        ? (sev === 'critical' || sev === 'high' ? 'suspicious' : 'false_positive')
        : '';
    return {
      proposal:   proposalFn(sev),
      rationale:  `Heuristik (${this.name}): Severity '${sev}' → Basis-Confidence ${base}. Kein externes Modell befragt.`,
      verdict,
      confidence: base,
      model:      this.name,
    };
  }
}

module.exports = { StubLlmProvider };
