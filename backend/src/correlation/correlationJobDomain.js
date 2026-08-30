'use strict';

const crypto = require('crypto');

/**
 * P_CORR_1a — Domain-Modell für die asynchrone, materialisierte Korrelation.
 *
 *   Ticket/Evidence/Flow geändert → CorrelationJob (persistent) → Worker →
 *   CorrelationResult (materialisiert) → UI liest Resultat + Status.
 *
 * Reine Domäne (keine DB, keine Fetches) → gut testbar. Repos (InMemory/Postgres)
 * persistieren `toJSON()`. Die eigentliche Korrelation rechnet die bestehende pure
 * `CorrelationEngine`; dieses Modell beschreibt NUR Job-Lebenszyklus + Ergebnis-Bezug.
 *
 * Idempotenz: gleicher `inputHash` (= Ticket + Revision + Engine-Version) ⇒ kein Doppeljob;
 * ein vorhandenes Ergebnis kann wiederverwendet werden. Ein Ergebnis darf nur geschrieben
 * werden, solange die Eingaberevision noch gültig ist (Vergleich `sourceRevision`).
 */

// Engine-Version: bei jeder fachlichen Änderung der CorrelationEngine erhöhen →
// alte Ergebnisse bekommen einen anderen inputHash und werden neu berechnet.
// ce-2: PowerShell ScriptBlock (Event 4104, scriptBlockText) → process.commandLine.
// ce-3: Cowrie-Honeypot-Felder (data.src_ip/src_port/dst_ip/dst_port/input) gemappt
// (echter Angreifer als Quelle, Befehl als Command). Bump = Neuberechnung alter Results.
// ce-4: generischer Normalizer übernimmt jetzt ALLE Ticketfelder — flache Prozessfelder
// (process/commandLine/hash), typisierte payloads (Command→commandLine, Login→user),
// logs→raw und ERMITTELTE payload.contains* statt fest verdrahteter 'unknown'.
// Gilt für alle Quellen außer wazuh (das behält seinen eigenen Roh-Alert-Parser).
const CORRELATION_ENGINE_VERSION = 'ce-4';

const CORRELATION_STATUS = Object.freeze({
  PENDING:   'pending',
  RUNNING:   'running',
  COMPLETED: 'completed',
  RETRYING:  'retrying',
  FAILED:    'failed',
});

const TERMINAL = new Set([CORRELATION_STATUS.COMPLETED, CORRELATION_STATUS.FAILED]);

// Erlaubte Übergänge — alles andere wirft (kein stiller Fehlzustand).
const TRANSITIONS = Object.freeze({
  [CORRELATION_STATUS.PENDING]:   new Set([CORRELATION_STATUS.RUNNING]),
  [CORRELATION_STATUS.RUNNING]:   new Set([CORRELATION_STATUS.COMPLETED, CORRELATION_STATUS.RETRYING, CORRELATION_STATUS.FAILED]),
  [CORRELATION_STATUS.RETRYING]:  new Set([CORRELATION_STATUS.RUNNING, CORRELATION_STATUS.FAILED]),
  [CORRELATION_STATUS.COMPLETED]: new Set(),
  [CORRELATION_STATUS.FAILED]:    new Set(),
});

// Obergrenze für referenzierte Quell-Tickets pro Ergebnis (kein unbounded Persist).
const MAX_RESULT_EVIDENCE = 500;

/**
 * Deterministischer Idempotenz-Schlüssel. Hash über kanonische Eingabe, sodass
 * gleiche Eingabe denselben Hash ergibt (Reihenfolge der Felder fixiert).
 * `sourceRevision` kapselt den Zustand von Ticket + relevanten Childs (vom Aufrufer
 * gebildet, z.B. max(updatedAt) über Parent+Childs).
 */
function computeInputHash({ ticketId, sourceRevision, engineVersion = CORRELATION_ENGINE_VERSION } = {}) {
  if (!ticketId) throw new Error('computeInputHash: ticketId fehlt');
  if (!sourceRevision) throw new Error('computeInputHash: sourceRevision fehlt');
  const canonical = JSON.stringify({ t: String(ticketId), r: String(sourceRevision), e: String(engineVersion) });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

class CorrelationJob {
  constructor({
    id = crypto.randomUUID(),
    ticketId,
    inputHash,
    sourceRevision,
    engineVersion = CORRELATION_ENGINE_VERSION,
    status = CORRELATION_STATUS.PENDING,
    retryCount = 0,
    failureReason = null,
    resultReference = null,
    createdAt = new Date().toISOString(),
    startedAt = null,
    completedAt = null,
  } = {}) {
    this.id              = id;
    this.ticketId        = ticketId;
    this.inputHash       = inputHash;
    this.sourceRevision  = sourceRevision;
    this.engineVersion   = engineVersion;
    this.status          = status;
    this.retryCount      = retryCount;
    this.failureReason   = failureReason;
    this.resultReference = resultReference;
    this.createdAt       = createdAt;
    this.startedAt       = startedAt;
    this.completedAt     = completedAt;
  }

  static create({ ticketId, sourceRevision, engineVersion = CORRELATION_ENGINE_VERSION } = {}) {
    if (!ticketId)       throw new Error('CorrelationJob.create: ticketId fehlt');
    if (!sourceRevision) throw new Error('CorrelationJob.create: sourceRevision fehlt');
    return new CorrelationJob({
      ticketId,
      sourceRevision,
      engineVersion,
      inputHash: computeInputHash({ ticketId, sourceRevision, engineVersion }),
      status: CORRELATION_STATUS.PENDING,
    });
  }

  isTerminal() { return TERMINAL.has(this.status); }

  _transition(next) {
    const allowed = TRANSITIONS[this.status];
    if (!allowed || !allowed.has(next)) {
      throw new Error(`Ungültiger Korrelations-Statuswechsel: ${this.status} → ${next}`);
    }
    this.status = next;
  }

  start() {
    this._transition(CORRELATION_STATUS.RUNNING);
    this.startedAt = new Date().toISOString();
    return this;
  }

  complete(resultReference) {
    if (!resultReference) throw new Error('CorrelationJob.complete: resultReference fehlt');
    this._transition(CORRELATION_STATUS.COMPLETED);
    this.resultReference = resultReference;
    this.failureReason   = null;
    this.completedAt     = new Date().toISOString();
    return this;
  }

  // Transienter Fehler → wartet auf Retry (bounded Retries setzt der Worker via maxRetries durch).
  retry(reason = '') {
    this._transition(CORRELATION_STATUS.RETRYING);
    this.retryCount += 1;
    this.failureReason = reason || this.failureReason || 'unbekannter Fehler';
    return this;
  }

  // Endgültiger Fehlschlag (Retries erschöpft) — sichtbar, kein stiller Drop.
  fail(reason = '') {
    this._transition(CORRELATION_STATUS.FAILED);
    this.failureReason = reason || this.failureReason || 'unbekannter Fehler';
    this.completedAt   = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      id: this.id, ticketId: this.ticketId, inputHash: this.inputHash,
      sourceRevision: this.sourceRevision, engineVersion: this.engineVersion,
      status: this.status, retryCount: this.retryCount, failureReason: this.failureReason,
      resultReference: this.resultReference, createdAt: this.createdAt,
      startedAt: this.startedAt, completedAt: this.completedAt,
    };
  }
}

class CorrelationResult {
  constructor({
    id = crypto.randomUUID(),
    ticketId,
    jobId,
    inputHash,
    sourceRevision,
    engineVersion = CORRELATION_ENGINE_VERSION,
    result = null,
    evidenceRefs = [],
    createdAt = new Date().toISOString(),
  } = {}) {
    if (!ticketId)  throw new Error('CorrelationResult: ticketId fehlt');
    if (!inputHash) throw new Error('CorrelationResult: inputHash fehlt');
    if (evidenceRefs.length > MAX_RESULT_EVIDENCE) {
      throw new Error(`CorrelationResult: zu viele Evidence-Referenzen (${evidenceRefs.length} > ${MAX_RESULT_EVIDENCE})`);
    }
    this.id             = id;
    this.ticketId       = ticketId;
    this.jobId          = jobId;
    this.inputHash      = inputHash;
    this.sourceRevision = sourceRevision;
    this.engineVersion  = engineVersion;
    this.result         = result;
    // Vollständiger Rückverweis auf die beitragende Evidence/Quell-Tickets.
    this.evidenceRefs   = evidenceRefs.map((e) => normalizeEvidenceRef(e));
    this.createdAt      = createdAt;
  }

  toJSON() {
    return {
      id: this.id, ticketId: this.ticketId, jobId: this.jobId, inputHash: this.inputHash,
      sourceRevision: this.sourceRevision, engineVersion: this.engineVersion,
      result: this.result, evidenceRefs: this.evidenceRefs, createdAt: this.createdAt,
    };
  }
}

// Ein Evidence-Rückverweis: welches Quell-Ticket (+ optional Evidence-Item) in welcher Rolle beitrug.
const EVIDENCE_ROLES = new Set(['subject', 'parent', 'child']);
function normalizeEvidenceRef(e = {}) {
  const role = EVIDENCE_ROLES.has(e.role) ? e.role : 'child';
  if (!e.ticketId) throw new Error('evidenceRef: ticketId fehlt');
  return { ticketId: String(e.ticketId), role, evidenceId: e.evidenceId ? String(e.evidenceId) : null };
}

module.exports = {
  CorrelationJob,
  CorrelationResult,
  CORRELATION_STATUS,
  CORRELATION_ENGINE_VERSION,
  MAX_RESULT_EVIDENCE,
  computeInputHash,
  normalizeEvidenceRef,
};
