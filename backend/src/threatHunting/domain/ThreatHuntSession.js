'use strict';

const { randomUUID } = require('crypto');

/**
 * Gültige Status-Übergänge einer ThreatHuntSession.
 *
 * planned → active → completed | failed | cancelled
 * active  → cancelled | failed
 */
const SESSION_STATUS = Object.freeze({
  PLANNED:   'planned',
  ACTIVE:    'active',
  COMPLETED: 'completed',
  FAILED:    'failed',
  CANCELLED: 'cancelled',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [SESSION_STATUS.PLANNED]:   [SESSION_STATUS.ACTIVE, SESSION_STATUS.CANCELLED],
  [SESSION_STATUS.ACTIVE]:    [SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.CANCELLED],
  [SESSION_STATUS.COMPLETED]: [],
  [SESSION_STATUS.FAILED]:    [],
  [SESSION_STATUS.CANCELLED]: [],
});

class ThreatHuntSession {
  /**
   * @param {object} props
   * @param {string}  props.id
   * @param {string}  props.ticketId       — verknüpftes SOC-Ticket (kann leer sein)
   * @param {string}  props.analystId      — auslösender Analyst
   * @param {string}  props.targetHost     — Ziel-Host / IP / FQDN
   * @param {string}  props.scope          — Hunt-Ziel / Freitext
   * @param {string}  props.status         — SESSION_STATUS
   * @param {string}  props.hypothesis     — Ausgangs-Hypothese
   * @param {Date}    props.createdAt
   * @param {Date}    props.updatedAt
   * @param {Date|null} props.startedAt
   * @param {Date|null} props.closedAt
   */
  constructor(props) {
    this.id          = props.id;
    this.ticketId    = props.ticketId    || null;
    this.analystId   = props.analystId;
    this.targetHost  = props.targetHost;
    this.scope       = props.scope       || '';
    this.hypothesis  = props.hypothesis  || '';
    this.status      = props.status;
    // Additiv (Hunt-Runner / Operations-Center) — optional, back-kompatibel:
    this.huntType      = props.huntType      || '';     // z.B. suspicious_powershell_hunt
    this.title         = props.title         || '';     // Anzeigename
    this.riskLevel     = props.riskLevel     || 'low';  // low|medium|high|critical
    this.summary       = props.summary       || '';
    this.findingsCount = Number.isFinite(props.findingsCount) ? props.findingsCount : 0;
    this.createdAt   = props.createdAt   instanceof Date ? props.createdAt : new Date(props.createdAt);
    this.updatedAt   = props.updatedAt   instanceof Date ? props.updatedAt : new Date(props.updatedAt);
    this.startedAt   = props.startedAt   ? new Date(props.startedAt) : null;
    this.closedAt    = props.closedAt    ? new Date(props.closedAt)  : null;
  }

  /** Factory — neue Session anlegen */
  static create({ ticketId = null, analystId, targetHost, scope = '', hypothesis = '',
    huntType = '', title = '', riskLevel = 'low' }) {
    if (!analystId?.trim())   throw new Error('ThreatHuntSession: analystId ist Pflichtfeld');
    if (!targetHost?.trim())  throw new Error('ThreatHuntSession: targetHost ist Pflichtfeld');

    const now = new Date();
    return new ThreatHuntSession({
      id:         randomUUID(),
      ticketId,
      analystId:  analystId.trim(),
      targetHost: targetHost.trim(),
      scope:      scope.trim(),
      hypothesis: hypothesis.trim(),
      huntType:   String(huntType || '').trim(),
      title:      String(title || '').trim(),
      riskLevel:  riskLevel || 'low',
      summary:    '',
      findingsCount: 0,
      status:     SESSION_STATUS.PLANNED,
      createdAt:  now,
      updatedAt:  now,
      startedAt:  null,
      closedAt:   null,
    });
  }

  /** Runner-Ergebnis übernehmen: Anzahl Findings, Risiko, Summary. */
  applyRunResult({ findingsCount, riskLevel, summary }) {
    if (Number.isFinite(findingsCount)) this.findingsCount = findingsCount;
    if (riskLevel) this.riskLevel = riskLevel;
    if (summary)   this.summary = summary;
    this.updatedAt = new Date();
  }

  /** Factory — Wiederherstellung aus Persistence */
  static fromPersistence(raw) {
    return new ThreatHuntSession(raw);
  }

  /** Session aktivieren (planned → active) */
  activate() {
    this._transition(SESSION_STATUS.ACTIVE);
    this.startedAt = new Date();
    this.updatedAt = new Date();
  }

  /** Session abschließen (active → completed) */
  complete() {
    this._transition(SESSION_STATUS.COMPLETED);
    this.closedAt  = new Date();
    this.updatedAt = new Date();
  }

  /** Session als gescheitert markieren (active → failed) */
  fail(reason = '') {
    this._transition(SESSION_STATUS.FAILED);
    this.closedAt  = new Date();
    this.updatedAt = new Date();
    if (reason) this.scope += `\n[FAILED] ${reason}`;
  }

  /** Session abbrechen (planned | active → cancelled) */
  cancel() {
    this._transition(SESSION_STATUS.CANCELLED);
    this.closedAt  = new Date();
    this.updatedAt = new Date();
  }

  isOpen()   { return [SESSION_STATUS.PLANNED, SESSION_STATUS.ACTIVE].includes(this.status); }
  isClosed() { return !this.isOpen(); }

  _transition(nextStatus) {
    const allowed = ALLOWED_TRANSITIONS[this.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(
        `ThreatHuntSession: Ungültiger Übergang ${this.status} → ${nextStatus}`,
      );
    }
    this.status = nextStatus;
  }

  toJSON() {
    return {
      id:         this.id,
      ticketId:   this.ticketId,
      analystId:  this.analystId,
      targetHost: this.targetHost,
      scope:      this.scope,
      hypothesis: this.hypothesis,
      huntType:      this.huntType,
      title:         this.title,
      riskLevel:     this.riskLevel,
      summary:       this.summary,
      findingsCount: this.findingsCount,
      status:     this.status,
      createdAt:  this.createdAt.toISOString(),
      updatedAt:  this.updatedAt.toISOString(),
      startedAt:  this.startedAt  ? this.startedAt.toISOString()  : null,
      closedAt:   this.closedAt   ? this.closedAt.toISOString()   : null,
    };
  }
}

module.exports = { ThreatHuntSession, SESSION_STATUS, ALLOWED_TRANSITIONS };
