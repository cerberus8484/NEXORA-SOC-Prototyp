'use strict';

const logger = require('../logger');
const { CorrelationJob, computeInputHash, CORRELATION_ENGINE_VERSION } = require('./correlationJobDomain');

/**
 * CorrelationSchedulingService — P_CORR_1c.1. ZENTRALER Trigger für die asynchrone Korrelation.
 *
 *   Datenänderung → persistenten Correlation-Job idempotent anlegen → Queue benachrichtigen → Worker
 *
 * Wird von allen relevanten Mutation-Pfaden genutzt (kein verstreutes `queue.enqueue` in Routen).
 *
 * Garantie: Der PERSISTIERTE Job ist die Wahrheit; die Queue ist nur Ausführungsmechanismus.
 * Scheitert das Enqueue, bleibt der Job persistent `pending` (kein Rollback, KEIN Fake-Erfolg) —
 * `reconcile()` reiht ihn später erneut ein; der Fehler wird sichtbar geloggt + metrisch erfasst.
 */

// Felder, die NUR den Analyst-Workflow betreffen → lösen KEINE Korrelation aus
// (die CorrelationEngine nutzt diese Daten nicht). Alles andere gilt als relevant.
const WORKFLOW_ONLY_FIELDS = new Set([
  'analyst', 'assignee', 'owner', 'status', 'state', 'priority',
  'notes', 'comment', 'comments', 'tags', 'dueDate', 'reviewStatus', 'updatedAt',
]);

function isRelevantTicketChange(changedFields = []) {
  const fields = Array.isArray(changedFields) ? changedFields : Object.keys(changedFields || {});
  return fields.some((f) => !WORKFLOW_ONLY_FIELDS.has(f));
}

class CorrelationSchedulingService {
  constructor({ repo, queue, queueName, metrics = null, engineVersion = CORRELATION_ENGINE_VERSION } = {}) {
    if (!repo || !queue || !queueName) {
      throw new Error('CorrelationSchedulingService: repo, queue und queueName sind erforderlich');
    }
    this._repo          = repo;
    this._queue         = queue;
    this._queueName     = queueName;
    this._metrics       = metrics;
    this._engineVersion = engineVersion;
  }

  /** Trigger aus einem Ticket-Update — nur wenn engine-relevante Felder geändert wurden. */
  async onTicketChanged(ticket, changedFields = []) {
    if (!ticket || !ticket.id) return { scheduled: false, reason: 'no-ticket' };
    if (!isRelevantTicketChange(changedFields)) return { scheduled: false, reason: 'irrelevant' };
    return this.schedule({ ticketId: ticket.id, sourceRevision: String(ticket.updatedAt ?? ''), reason: 'ticket' });
  }

  /** Trigger aus einer Evidence-/Flow-Änderung (immer relevant). Caller liefert die sourceRevision. */
  async onInputChanged({ ticketId, sourceRevision, reason = 'input' } = {}) {
    return this.schedule({ ticketId, sourceRevision, reason });
  }

  /** Zentral: idempotent einen persistenten pending-Job anlegen, dann die Queue benachrichtigen. */
  async schedule({ ticketId, sourceRevision, reason = 'change' } = {}) {
    const persistent = await this.ensurePersistentJob({ ticketId, sourceRevision, reason });
    if (!persistent.scheduled) return persistent;
    const enqueued = await this.notifyQueue(persistent.job, persistent.inputHash);
    return { scheduled: true, jobId: persistent.job.id, enqueued, reason };
  }

  async ensurePersistentJob({ ticketId, sourceRevision, reason = 'change' } = {}) {
    if (!ticketId || !sourceRevision) return { scheduled: false, reason: 'missing-input' };
    const inputHash = computeInputHash({ ticketId, sourceRevision, engineVersion: this._engineVersion });

    // Idempotenz: bereits ein aktiver Job für diesen Input → kein Doppeljob.
    let job = await this._repo.findActiveJobByInputHash(inputHash);
    if (!job) {
      const created = CorrelationJob.create({ ticketId, sourceRevision, engineVersion: this._engineVersion });
      try {
        job = await this._repo.createJob(created.toJSON());
      } catch (err) {
        // Race: zwei Mutationen gleichzeitig → den bestehenden aktiven Job nutzen (kein Doppeljob).
        if (err.code === 'ACTIVE_INPUT_CONFLICT' && err.existing) job = err.existing;
        else throw err;
      }
    }

    return { scheduled: true, job, jobId: job.id, inputHash, reason };
  }

  // Queue benachrichtigen. Fehler darf den persistenten Job NICHT verlieren → kein Throw, kein Fake.
  async notifyQueue(job, inputHash) {
    try {
      await this._queue.enqueue(this._queueName, { correlationJobId: job.id }, { singletonKey: inputHash });
      return true;
    } catch (err) {
      logger.error('correlation_enqueue_failed', { jobId: job.id, message: err.message });
      if (this._metrics && typeof this._metrics.enqueueFailed === 'function') this._metrics.enqueueFailed();
      return false; // ehrlich: enqueued=false, Job bleibt persistent pending
    }
  }

  /** Recovery: noch nicht ausgeführte Jobs (pending|retrying) erneut einreihen (bounded). */
  async reconcile({ limit = 100 } = {}) {
    const jobs = await this._repo.findSchedulableJobs({ limit });
    let requeued = 0;
    for (const job of jobs) {
      if (await this.notifyQueue(job, job.inputHash)) requeued += 1;
    }
    logger.info('correlation_reconcile', { total: jobs.length, requeued });
    return { total: jobs.length, requeued };
  }
}

module.exports = { CorrelationSchedulingService, isRelevantTicketChange, WORKFLOW_ONLY_FIELDS };
