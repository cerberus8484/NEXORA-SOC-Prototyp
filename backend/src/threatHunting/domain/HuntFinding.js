'use strict';

const { randomUUID } = require('crypto');

/**
 * Schweregrade eines HuntFinding — bewusst gleiche Werte wie Ticket-Severity,
 * damit P13.4 (Evidence-Link zurück ans Ticket) ohne Mapping auskommt.
 */
const FINDING_SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH:     'high',
  MEDIUM:   'medium',
  LOW:      'low',
  INFO:     'info',
});

/**
 * Confidence-Level — wie sicher ist der Analyst?
 */
const FINDING_CONFIDENCE = Object.freeze({
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low',
});

/**
 * Analyst-Verdict für ein HuntFinding — erstklassiges Feld (nicht context.verdict).
 * Leerer String = kein Verdict gesetzt (Default nach Erstellung).
 */
const FINDING_VERDICT = Object.freeze({
  NONE:         '',
  BENIGN:       'benign',
  SUSPICIOUS:   'suspicious',
  MALICIOUS:    'malicious',
  INCONCLUSIVE: 'inconclusive',
});

/**
 * HuntFinding — Auswertung des Analysten über gesammelte Artefakte.
 *
 * Ein Finding kann mehrere Artefakte referenzieren (artifactIds[]).
 * Es kann direkt ans Ticket gelinkt werden (ticketId).
 * Es ist das zentrale Objekt, das P13.4 für den Evidence-Link nutzt.
 */
class HuntFinding {
  /**
   * @param {object}   props
   * @param {string}   props.id
   * @param {string}   props.sessionId      — ThreatHuntSession.id
   * @param {string}   props.title          — kurze Beschreibung
   * @param {string}   props.description    — ausführliche Analyse
   * @param {string}   props.severity       — FINDING_SEVERITY
   * @param {string}   props.confidence     — FINDING_CONFIDENCE
   * @param {string[]} props.artifactIds    — referenzierte HuntArtifact.id[]
   * @param {string}   props.mitreAttack    — ATT&CK Tactic/Technique (optional)
   * @param {string}   props.recommendation — empfohlene Maßnahme
   * @param {string}   props.analystId      — wer hat das Finding erstellt?
   * @param {string|null} props.ticketId    — verknüpftes Ticket (P13.4)
   * @param {string}   props.verdict       — Analyst-Verdict (FINDING_VERDICT), Default ''
   * @param {Date}     props.createdAt
   * @param {Date}     props.updatedAt
   */
  constructor(props) {
    this.id             = props.id;
    this.sessionId      = props.sessionId;
    this.title          = props.title;
    this.description    = props.description    || '';
    this.severity       = props.severity;
    this.confidence     = props.confidence;
    this.artifactIds    = Array.isArray(props.artifactIds) ? [...props.artifactIds] : [];
    this.mitreAttack    = props.mitreAttack    || '';
    this.recommendation = props.recommendation || '';
    this.analystId      = props.analystId;
    this.ticketId       = props.ticketId       || null;
    // Erstklassiges Verdict (nicht context.verdict — bleibt für Rückwärtskompatibilität).
    this.verdict        = typeof props.verdict === 'string' ? props.verdict : '';
    // Additiv: reiche Kontextfelder fürs Detail-Panel (host, user, process, pid,
    // commandLine, sourceIp, destinationIp, destinationPort, protocol, source,
    // verdict (legacy), mitreTactic, mitreTechnique, confidencePct, ruleId, status …).
    this.context        = props.context && typeof props.context === 'object' ? props.context : {};
    this.createdAt      = props.createdAt instanceof Date ? props.createdAt : new Date(props.createdAt);
    this.updatedAt      = props.updatedAt instanceof Date ? props.updatedAt : new Date(props.updatedAt);
  }

  static create({
    sessionId,
    title,
    description    = '',
    severity,
    confidence     = FINDING_CONFIDENCE.MEDIUM,
    artifactIds    = [],
    mitreAttack    = '',
    recommendation = '',
    analystId,
    ticketId       = null,
    verdict        = '',
    context        = {},
  }) {
    if (!sessionId?.trim()) throw new Error('HuntFinding: sessionId ist Pflichtfeld');
    if (!title?.trim())     throw new Error('HuntFinding: title ist Pflichtfeld');
    if (!analystId?.trim()) throw new Error('HuntFinding: analystId ist Pflichtfeld');

    const validSeverities  = Object.values(FINDING_SEVERITY);
    const validConfidences = Object.values(FINDING_CONFIDENCE);

    if (!validSeverities.includes(severity)) {
      throw new Error(`HuntFinding: Ungültige Severity "${severity}". Erlaubt: ${validSeverities.join(', ')}`);
    }
    if (!validConfidences.includes(confidence)) {
      throw new Error(`HuntFinding: Ungültige Confidence "${confidence}". Erlaubt: ${validConfidences.join(', ')}`);
    }

    const now = new Date();
    return new HuntFinding({
      id:             randomUUID(),
      sessionId:      sessionId.trim(),
      title:          title.trim(),
      description:    description.trim(),
      severity,
      confidence,
      artifactIds:    [...artifactIds],
      mitreAttack:    mitreAttack.trim(),
      recommendation: recommendation.trim(),
      analystId:      analystId.trim(),
      ticketId:       ticketId || null,
      verdict:        typeof verdict === 'string' ? verdict : '',
      context:        context && typeof context === 'object' ? context : {},
      createdAt:      now,
      updatedAt:      now,
    });
  }

  static fromPersistence(raw) {
    return new HuntFinding({
      ...raw,
      artifactIds: Array.isArray(raw.artifactIds) ? raw.artifactIds : JSON.parse(raw.artifactIds || '[]'),
      context:     raw.context && typeof raw.context === 'object'
        ? raw.context
        : (typeof raw.context === 'string' ? JSON.parse(raw.context || '{}') : {}),
      // verdict: NULL aus DB (vor Migration 024) → leerer String
      verdict: typeof raw.verdict === 'string' ? raw.verdict : '',
    });
  }

  /** Artefakt nachträglich referenzieren */
  addArtifact(artifactId) {
    if (!this.artifactIds.includes(artifactId)) {
      this.artifactIds.push(artifactId);
      this.updatedAt = new Date();
    }
  }

  /** Ticket verknüpfen (P13.4) */
  linkToTicket(ticketId) {
    this.ticketId  = ticketId;
    this.updatedAt = new Date();
  }

  /**
   * Analyst-Verdict setzen (Block B2).
   * Validiert gegen FINDING_VERDICT — wirft bei ungültigem Wert.
   * context.verdict (Legacy) bleibt unangetastet.
   * @param {string} verdict — FINDING_VERDICT-Wert
   */
  setVerdict(verdict) {
    const validVerdicts = Object.values(FINDING_VERDICT);
    if (!validVerdicts.includes(verdict)) {
      throw new Error(
        `Ungültiges Verdict "${verdict}". Erlaubt: ${validVerdicts.filter(v => v !== '').join(', ')} oder leer.`,
      );
    }
    this.verdict   = verdict;
    this.updatedAt = new Date();
  }

  toJSON() {
    return {
      id:             this.id,
      sessionId:      this.sessionId,
      title:          this.title,
      description:    this.description,
      severity:       this.severity,
      confidence:     this.confidence,
      artifactIds:    [...this.artifactIds],
      mitreAttack:    this.mitreAttack,
      recommendation: this.recommendation,
      analystId:      this.analystId,
      ticketId:       this.ticketId,
      verdict:        this.verdict,
      context:        { ...this.context },
      createdAt:      this.createdAt.toISOString(),
      updatedAt:      this.updatedAt.toISOString(),
    };
  }
}

module.exports = { HuntFinding, FINDING_SEVERITY, FINDING_CONFIDENCE, FINDING_VERDICT };
