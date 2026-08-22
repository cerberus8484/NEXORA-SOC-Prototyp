'use strict';

const { randomUUID } = require('crypto');

/**
 * Status eines HuntCommand.
 * Kein echter Remote-Execution-Status — rein fachliche Modellierung.
 *
 * queued → running → completed | failed | blocked
 * queued → blocked (z.B. Genehmigung ausstehend)
 */
const COMMAND_STATUS = Object.freeze({
  QUEUED:    'queued',
  RUNNING:   'running',
  COMPLETED: 'completed',
  FAILED:    'failed',
  BLOCKED:   'blocked',
});

const COMMAND_TRANSITIONS = Object.freeze({
  [COMMAND_STATUS.QUEUED]:    [COMMAND_STATUS.RUNNING,    COMMAND_STATUS.BLOCKED],
  [COMMAND_STATUS.RUNNING]:   [COMMAND_STATUS.COMPLETED,  COMMAND_STATUS.FAILED],
  [COMMAND_STATUS.COMPLETED]: [],
  [COMMAND_STATUS.FAILED]:    [],
  [COMMAND_STATUS.BLOCKED]:   [COMMAND_STATUS.QUEUED],   // nach Genehmigung: zurück in Queue
});

/**
 * Typen von Hunt-Commands (für spätere Runner-Abstraktion).
 * P13.1: nur Modell — kein echter Executor.
 */
const COMMAND_TYPE = Object.freeze({
  MANUAL:         'manual',          // Analyst gibt Kommando manuell ein
  OSQUERY:        'osquery',         // OSQuery-Statement
  YARA:           'yara',            // YARA-Rule
  SIGMA:          'sigma',           // Sigma-Rule
  POWERSHELL:     'powershell',      // PowerShell (Remote — P13.5+)
  BASH:           'bash',            // Bash (Remote — P13.5+)
  LOG_SEARCH:     'log_search',      // SIEM/Log-Suche
  NETWORK_SCAN:   'network_scan',    // Netzwerk-Analyse
});

class HuntCommand {
  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.sessionId   — ThreatHuntSession.id
   * @param {string} props.type        — COMMAND_TYPE
   * @param {string} props.command     — eigentlicher Befehl / Query / Rule
   * @param {string} props.description — was soll dieser Command herausfinden?
   * @param {string} props.status      — COMMAND_STATUS
   * @param {string} props.result      — Rohausgabe / Ergebnis (Freitext)
   * @param {string} props.analystId   — wer hat diesen Command ausgelöst?
   * @param {Date}   props.createdAt
   * @param {Date}   props.updatedAt
   * @param {Date|null} props.executedAt
   */
  constructor(props) {
    this.id            = props.id;
    this.sessionId     = props.sessionId;
    this.type          = props.type;
    this.command       = props.command;
    this.description   = props.description   || '';
    this.status        = props.status;
    // Legacy compat + neue Felder
    this.result        = props.result        || '';
    this.stdout        = props.stdout        || '';
    this.stderr        = props.stderr        || '';
    this.exitCode      = props.exitCode      ?? null;
    this.blockedReason = props.blockedReason || '';
    this.analystId     = props.analystId;
    this.createdAt     = props.createdAt     instanceof Date ? props.createdAt : new Date(props.createdAt);
    this.updatedAt     = props.updatedAt     instanceof Date ? props.updatedAt : new Date(props.updatedAt);
    this.executedAt    = props.executedAt    ? new Date(props.executedAt) : null;
    this.completedAt   = props.completedAt   ? new Date(props.completedAt) : null;
  }

  static create({ sessionId, type, command, description = '', analystId }) {
    if (!sessionId?.trim())  throw new Error('HuntCommand: sessionId ist Pflichtfeld');
    if (!command?.trim())    throw new Error('HuntCommand: command ist Pflichtfeld');
    if (!analystId?.trim())  throw new Error('HuntCommand: analystId ist Pflichtfeld');

    const validTypes = Object.values(COMMAND_TYPE);
    if (!validTypes.includes(type)) {
      throw new Error(`HuntCommand: Ungültiger Typ "${type}". Erlaubt: ${validTypes.join(', ')}`);
    }

    const now = new Date();
    return new HuntCommand({
      id:            randomUUID(),
      sessionId:     sessionId.trim(),
      type,
      command:       command.trim(),
      description:   description.trim(),
      status:        COMMAND_STATUS.QUEUED,
      result:        '',
      stdout:        '',
      stderr:        '',
      exitCode:      null,
      blockedReason: '',
      analystId:     analystId.trim(),
      createdAt:     now,
      updatedAt:     now,
      executedAt:    null,
      completedAt:   null,
    });
  }

  static fromPersistence(raw) {
    return new HuntCommand(raw);
  }

  /** Ausführung starten (queued → running) */
  start() {
    this._transition(COMMAND_STATUS.RUNNING);
    this.executedAt = new Date();
    this.updatedAt  = new Date();
  }

  /** Ergebnis setzen und abschließen (running → completed) */
  complete({ stdout = '', stderr = '', exitCode = null } = {}) {
    this._transition(COMMAND_STATUS.COMPLETED);
    this.stdout      = stdout;
    this.stderr      = stderr;
    this.exitCode    = exitCode;
    this.result      = stdout || '';   // Legacy-Compat
    this.completedAt = new Date();
    this.updatedAt   = new Date();
  }

  /** Als gescheitert markieren (running → failed) */
  fail({ reason = '', stderr = '', exitCode = null } = {}) {
    this._transition(COMMAND_STATUS.FAILED);
    this.result        = reason;
    this.stderr        = stderr || reason;
    this.exitCode      = exitCode;
    this.completedAt   = new Date();
    this.updatedAt     = new Date();
  }

  /** Blockieren — z.B. wartet auf Genehmigung (queued → blocked) */
  block(reason = '') {
    this._transition(COMMAND_STATUS.BLOCKED);
    this.blockedReason = reason;
    this.updatedAt     = new Date();
  }

  /** Wieder in Queue (blocked → queued) */
  requeue() {
    this._transition(COMMAND_STATUS.QUEUED);
    this.blockedReason = '';
    this.updatedAt     = new Date();
  }

  isTerminal() {
    return [COMMAND_STATUS.COMPLETED, COMMAND_STATUS.FAILED].includes(this.status);
  }

  _transition(next) {
    const allowed = COMMAND_TRANSITIONS[this.status] || [];
    if (!allowed.includes(next)) {
      throw new Error(`HuntCommand: Ungültiger Übergang ${this.status} → ${next}`);
    }
    this.status = next;
  }

  toJSON() {
    return {
      id:            this.id,
      sessionId:     this.sessionId,
      type:          this.type,
      command:       this.command,
      description:   this.description,
      status:        this.status,
      result:        this.result,
      stdout:        this.stdout,
      stderr:        this.stderr,
      exitCode:      this.exitCode,
      blockedReason: this.blockedReason,
      analystId:     this.analystId,
      createdAt:     this.createdAt.toISOString(),
      updatedAt:     this.updatedAt.toISOString(),
      executedAt:    this.executedAt  ? this.executedAt.toISOString()  : null,
      completedAt:   this.completedAt ? this.completedAt.toISOString() : null,
    };
  }
}

module.exports = { HuntCommand, COMMAND_STATUS, COMMAND_TYPE, COMMAND_TRANSITIONS };
