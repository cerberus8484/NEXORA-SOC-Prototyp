'use strict';

const logger = require('../logger');
const { createQueueService } = require('../queue/queueServiceFactory');
const { createCorrelationRepository } = require('../repositories/correlationRepositoryFactory');
const { QUEUES } = require('../queue/QueueService');
const { CorrelationSchedulingService } = require('./CorrelationSchedulingService');
const { CorrelationWorker } = require('./CorrelationWorker');
const { correlate } = require('./CorrelationEngine');

/**
 * Composition Root der asynchronen Korrelation (P_CORR_1c.1a).
 *
 * Genau EINE Queue-Instanz, EIN Correlation-Repository, EIN Scheduler, EIN Worker —
 * Scheduler UND Worker erhalten DIESELBEN Instanzen. So reiht der Scheduler in genau die
 * Queue ein, auf der der Worker hört (kein „Scheduler→Queue A, Worker→Queue B"-Fehler).
 *
 * Bei DB_ENABLED=true wählt die Factory die persistente pg-boss-Queue; ein Fehler beim
 * `start()` propagiert SICHTBAR — KEIN stiller Fallback auf InMemory.
 */

// Tickets-Adapter über den TicketService — bounded Children + Revision.
// `source_revision` = `ticket.updatedAt`, konsistent zwischen Scheduler (Trigger) und Worker (Recheck).
function buildTicketsAdapter(ticketService) {
  const safeFind = async (id) => {
    try {
      return await ticketService.findById(id);
    } catch (err) {
      // Nur das ERWARTETE „Ticket weg" → null. Echte Fehler (DB/Netz/Parse) MÜSSEN
      // propagieren, sonst quittiert der Worker den Job (correlation_worker_job_missing)
      // und der Korrelations-Job geht still verloren statt zu retryen.
      if (err && err.name === 'NotFoundError') return null;
      throw err;
    }
  };
  return {
    getById:      (id) => safeFind(id),
    findChildren: (id, opts) => ticketService.findChildren(id, opts),
    getRevision:  async (id) => { const t = await safeFind(id); return t ? t.updatedAt : null; },
  };
}

// EINE Composition mit geteilten Instanzen. Deps injizierbar (Tests) — sonst Factories.
// configProvider/statusReporter (Stufe 3) sind optional — ohne sie verhält sich der Worker
// exakt wie bisher (kein Live-Status-Report).
function buildCorrelationRuntime({ queue, repo, engine, tickets, metrics = null, configProvider = null, statusReporter = null, enableWorker = true } = {}) {
  if (!tickets) throw new Error('buildCorrelationRuntime: tickets-Adapter erforderlich');
  const q   = queue  || createQueueService();
  const r   = repo   || createCorrelationRepository();
  const eng = engine || { correlate };
  const queueName = QUEUES.CORRELATION_PROCESS;

  const scheduler = new CorrelationSchedulingService({ repo: r, queue: q, queueName, metrics });
  const worker    = new CorrelationWorker({ repo: r, queue: q, engine: eng, tickets, queueName, configProvider, statusReporter });

  let started = false;
  return {
    queue: q, repo: r, scheduler, worker, queueName, workerEnabled: enableWorker,
    async start() {
      if (started) return;
      await q.start();      // DB_ENABLED=true → pg-boss.start(); scheitert SICHTBAR (kein Fallback)
      // Rollen-Schnitt (Deployment-Phase 2): Die Queue braucht JEDE Rolle — die API reiht
      // per Schedule-on-Read Jobs ein. Verarbeitet wird nur in der Worker-Rolle. Läuft der
      // Korrelator als eigener Container, startet die API mit enableWorker=false; sonst
      // (Default) verhält sich alles wie bisher.
      if (enableWorker) await worker.start();
      started = true;
      logger.info('correlation_runtime_started', { queue: queueName, role: enableWorker ? 'worker' : 'api-only' });
    },
    async stop() {
      if (!started) return;
      if (enableWorker) await worker.stop();
      started = false;
      logger.info('correlation_runtime_stopped', { queue: queueName, role: enableWorker ? 'worker' : 'api-only' });
    },
    isStarted: () => started,
    reconcile: (opts) => scheduler.reconcile(opts),
    stats: () => q.stats(),
  };
}

// Lazy Singleton — EINE Instanz pro Prozess, geteilt von server.js (start/stop) und den Mutation-Routen.
let _runtime = null;
function getCorrelationRuntime() {
  if (!_runtime) {
    const { ticketService } = require('../services/TicketService');
    // Stufe 3: der reale Worker liest die angewendete Config + meldet seinen Live-Status,
    // damit der Apply-Health-Check echt prüfen kann (statt konservativ true).
    const { RuntimeConfigProvider } = require('../applyChannel/RuntimeConfigProvider');
    const { WorkerStatusReporter } = require('../applyChannel/WorkerStatusReporter');
    const { getApplyRepository } = require('../applyChannel/applyRepositoryFactory');
    const { getWorkerStatusRepository } = require('../applyChannel/workerStatusRepositoryFactory');
    // CORRELATION_WORKER_ENABLED=false → der Korrelator läuft als EIGENER Container
    // (Deployment-Profil `full`); dieser Prozess plant dann nur noch (Schedule-on-Read).
    // Default true = unverändertes Verhalten bestehender Installationen (fail-safe:
    // wer die Variable nicht kennt, verliert die Korrelation NICHT).
    const enableWorker = String(process.env.CORRELATION_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
    _runtime = buildCorrelationRuntime({
      tickets: buildTicketsAdapter(ticketService),
      configProvider: new RuntimeConfigProvider({ applyRepo: getApplyRepository() }),
      statusReporter: new WorkerStatusReporter({ repo: getWorkerStatusRepository(), workerId: 'correlation-worker' }),
      enableWorker,
    });
  }
  return _runtime;
}

module.exports = { buildCorrelationRuntime, buildTicketsAdapter, getCorrelationRuntime };
