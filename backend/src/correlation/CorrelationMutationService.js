'use strict';

const config = require('../config');
const logger = require('../logger');
const { Evidence, validateFileUpload } = require('../domain/Evidence');
const { NotFoundError } = require('../errors/AppError');
const { TicketService, ticketService } = require('../services/TicketService');
const { evidenceService } = require('../services/EvidenceService');
const { PostgresTicketRepository } = require('../repositories/PostgresTicketRepository');
const { PostgresEvidenceRepository } = require('../repositories/PostgresEvidenceRepository');
const { PostgresCorrelationRepository } = require('../repositories/PostgresCorrelationRepository');
const { CorrelationSchedulingService, isRelevantTicketChange } = require('./CorrelationSchedulingService');
const { getCorrelationRuntime } = require('./correlationRuntime');

function isTimeoutError(err) {
  return err && (err.code === '57014' || /timeout/i.test(err.message || ''));
}

function createTimedTxQueryFn(client, metricsRef) {
  return async (sql, params) => {
    try {
      return await client.query(sql, params);
    } catch (err) {
      if (isTimeoutError(err) && metricsRef && metricsRef.dbQueryTimeoutsTotal) {
        metricsRef.dbQueryTimeoutsTotal.inc();
      }
      throw err;
    }
  };
}

function normalizeEvidenceInput(data = {}) {
  if (!data.ticketId) return { ok: false, error: 'ticketId fehlt' };
  if (!data.title) return { ok: false, error: 'title fehlt' };
  if (data.type !== 'file_upload') return { ok: true, data };

  const content = data.content != null ? String(data.content) : String(data.rawText || '');
  const check = validateFileUpload({ filename: data.filename, content });
  if (!check.ok) return { ok: false, error: check.error };
  const toStore = { ...data, rawText: content };
  delete toStore.content;
  return { ok: true, data: toStore };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

class CorrelationMutationService {
  constructor({ runtimeFactory = getCorrelationRuntime } = {}) {
    this._runtimeFactory = runtimeFactory;
  }

  _runtime() {
    return this._runtimeFactory();
  }

  async updateTicket(id, data = {}, changedFields = []) {
    const fields = Array.isArray(changedFields) ? changedFields : Object.keys(data || {});
    if (!config.db.enabled) return this._updateTicketInMemory(id, data, fields);

    const { pool } = require('../db/pool');
    const { metrics } = require('../metrics/metricsRegistry');
    const runtime = this._runtime();
    const client = await pool.connect();
    let persistent = null;
    try {
      await client.query('BEGIN');
      const queryFn = createTimedTxQueryFn(client, metrics);
      const service = new TicketService(new PostgresTicketRepository({ queryFn }));
      const ticket = await service.update(id, data);

      if (isRelevantTicketChange(fields)) {
        const scheduler = new CorrelationSchedulingService({
          repo: new PostgresCorrelationRepository({ queryFn }),
          queue: runtime.queue,
          queueName: runtime.queueName,
        });
        persistent = await scheduler.ensurePersistentJob({
          ticketId: ticket.id,
          sourceRevision: iso(ticket.updatedAt),
          reason: 'ticket',
        });
      }

      await client.query('COMMIT');
      const enqueued = persistent && persistent.scheduled
        ? await runtime.scheduler.notifyQueue(persistent.job, persistent.inputHash)
        : false;
      return { ticket, correlation: persistent ? { ...persistent, enqueued } : { scheduled: false, reason: 'irrelevant' } };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async addEvidence(data = {}) {
    const normalized = normalizeEvidenceInput(data);
    if (!normalized.ok) return normalized;
    if (!config.db.enabled) return this._addEvidenceInMemory(normalized.data);

    const { pool } = require('../db/pool');
    const { metrics } = require('../metrics/metricsRegistry');
    const runtime = this._runtime();
    const client = await pool.connect();
    let persistent;
    try {
      await client.query('BEGIN');
      const queryFn = createTimedTxQueryFn(client, metrics);
      const repo = new PostgresEvidenceRepository({ queryFn });
      const evidence = await repo.create(normalized.data instanceof Evidence ? normalized.data : Evidence.create(normalized.data));
      const touched = await client.query('UPDATE tickets SET updated_at = NOW() WHERE id = $1 RETURNING updated_at', [evidence.ticketId]);
      if (touched.rowCount === 0) throw new NotFoundError('Ticket');

      const scheduler = new CorrelationSchedulingService({
        repo: new PostgresCorrelationRepository({ queryFn }),
        queue: runtime.queue,
        queueName: runtime.queueName,
      });
      persistent = await scheduler.ensurePersistentJob({
        ticketId: evidence.ticketId,
        sourceRevision: iso(touched.rows[0].updated_at),
        reason: 'evidence',
      });

      await client.query('COMMIT');
      const enqueued = await runtime.scheduler.notifyQueue(persistent.job, persistent.inputHash);
      return { ok: true, evidence, correlation: { ...persistent, enqueued } };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async _updateTicketInMemory(id, data, fields) {
    const ticket = await ticketService.update(id, data);
    if (!isRelevantTicketChange(fields)) return { ticket, correlation: { scheduled: false, reason: 'irrelevant' } };
    const runtime = this._runtime();
    const persistent = await runtime.scheduler.ensurePersistentJob({
      ticketId: ticket.id,
      sourceRevision: iso(ticket.updatedAt),
      reason: 'ticket',
    });
    const enqueued = persistent.scheduled ? await runtime.scheduler.notifyQueue(persistent.job, persistent.inputHash) : false;
    return { ticket, correlation: { ...persistent, enqueued } };
  }

  async _addEvidenceInMemory(data) {
    const result = await evidenceService.add(data);
    if (!result.ok) return result;
    try {
      const ticket = await ticketService.update(result.evidence.ticketId, {});
      const runtime = this._runtime();
      const persistent = await runtime.scheduler.ensurePersistentJob({
        ticketId: ticket.id,
        sourceRevision: iso(ticket.updatedAt),
        reason: 'evidence',
      });
      const enqueued = persistent.scheduled ? await runtime.scheduler.notifyQueue(persistent.job, persistent.inputHash) : false;
      return { ...result, correlation: { ...persistent, enqueued } };
    } catch (err) {
      if (err && err.name === 'NotFoundError') return result;
      logger.warn('correlation_inmemory_evidence_schedule_failed', { ticketId: result.evidence.ticketId, message: err.message });
      throw err;
    }
  }
}

const correlationMutationService = new CorrelationMutationService();

module.exports = {
  CorrelationMutationService,
  correlationMutationService,
  normalizeEvidenceInput,
  createTimedTxQueryFn,
};
