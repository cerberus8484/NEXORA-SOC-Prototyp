'use strict';

const { QueueService } = require('./QueueService');
const logger = require('../logger');

// pg-boss v12 ist ein ESM-Paket (type:module) und exportiert `PgBoss` als NAMED export.
// Es wird LAZY geladen (erst beim Konstruieren einer echten Instanz): so können Unit-Tests
// einen Mock-`boss` injizieren, ohne dass Jest (CommonJS) das ESM-Modul laden muss.
function loadPgBoss() {
  const mod = require('pg-boss');
  return mod.PgBoss || mod.default || mod;
}

/**
 * PgBossQueueService — PostgreSQL-basierte Job-Queue (persistente Produktiv-Grundlage).
 *
 * Modernisiert auf pg-boss v12 (P_CORR_0). Wichtige v12-Unterschiede gegenüber v8:
 *   - Queues müssen EXPLIZIT angelegt werden (`createQueue`) bevor send/work.
 *   - Retry/Expire sind KEINE Konstruktor-Optionen mehr → pro Queue (createQueue) bzw. pro send.
 *   - `work()` ruft den Handler mit einem ARRAY von Jobs (kein teamSize/teamConcurrency mehr).
 *   - Jeder Job hat { id, name, data }; mit includeMetadata zusätzlich retryCount/state.
 *
 * Fehlerhafte Handler werfen weiter → pg-boss markiert den Job als retry/failed und
 * verschiebt ihn nach erschöpften Retries in die Dead-Letter-Queue. KEIN stiller Erfolg.
 */

const DEAD_LETTER_SUFFIX = '.dlq';
const DEFAULT_RETRY = { retryLimit: 3, retryDelay: 30, retryBackoff: true };

// pg-boss unterhält seinen EIGENEN pg-Pool (getrennt vom App-Pool in db/pool.js). Ohne `max`
// nähme es den pg-Default (~10) → zwei Pools/Prozess (× N Worker-Container) können die
// soc_api-Verbindungen erschöpfen; Symptom: das ganze System läuft nach wenigen schnellen
// Ticket-Deletes in ein Timeout. Deshalb: gecappt (Default 4) + benannt (pg_stat_activity).
function buildPgBossConfig(env = process.env) {
  return {
    host:     env.DB_HOST     || 'localhost',
    port:     parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME     || 'soc_tickets_dev',
    user:     env.DB_USER     || 'soc_api',
    password: env.DB_PASSWORD || 'devpassword',
    ssl:      env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    schema:   env.PGBOSS_SCHEMA || 'pgboss',
    max:      parseInt(env.PGBOSS_POOL_MAX || '4', 10),
    application_name: 'nexora-pgboss',
  };
}

class PgBossQueueService extends QueueService {
  // `boss` injizierbar (Unit-Tests mit Mock). Sonst echte pg-boss-Instanz (lazy geladen).
  constructor({ boss } = {}) {
    super();
    this._boss = boss || PgBossQueueService._createRealBoss();

    this._ensured    = new Set(); // bereits angelegte Queues (+ DLQs) in diesem Prozess
    this._queueNames = new Set(); // bekannte Queues für stats()
    // Prozess-Zähler (für Metriken; setzen sich beim Neustart zurück — Prometheus-üblich).
    this._counts = { enqueued: 0, completed: 0, failed: 0, retried: 0 };

    this._boss.on('error', (err) => logger.error('pgboss_error', { message: err.message }));
  }

  // Echte pg-boss-v12-Instanz (lazy require → kein ESM-Load in der Jest-Unit-Suite).
  static _createRealBoss() {
    const PgBoss = loadPgBoss();
    return new PgBoss(buildPgBossConfig());
  }

  /** Queue + zugehörige Dead-Letter-Queue idempotent anlegen (Retry-Policy auf der Queue). */
  async _ensureQueue(queueName, opts = {}) {
    if (this._ensured.has(queueName)) return;
    const deadLetter = `${queueName}${DEAD_LETTER_SUFFIX}`;

    // DLQ zuerst (ohne eigene Retries) — Ziel für endgültig gescheiterte Jobs.
    await this._createQueueIdempotent(deadLetter, {});
    const queueConfig = {
      retryLimit:   opts.retryLimit   ?? DEFAULT_RETRY.retryLimit,
      retryDelay:   opts.retryDelay   ?? DEFAULT_RETRY.retryDelay,
      retryBackoff: opts.retryBackoff ?? DEFAULT_RETRY.retryBackoff,
      deadLetter,
    };
    // Optionale Queue-Policy (z.B. 'stately'/'exclusive') → Grundlage für Job-Idempotenz (P_CORR_1a).
    if (opts.policy) queueConfig.policy = opts.policy;
    await this._createQueueIdempotent(queueName, queueConfig);

    this._ensured.add(queueName);
    this._queueNames.add(queueName);
  }

  // createQueue ist nicht garantiert idempotent → vorher prüfen, Race defensiv abfangen.
  async _createQueueIdempotent(name, queueOpts) {
    try {
      const existing = await this._boss.getQueue(name);
      if (!existing) await this._boss.createQueue(name, queueOpts);
    } catch (err) {
      // Parallel angelegt? Wenn die Queue jetzt existiert, ist alles gut — sonst echter Fehler.
      const exists = await this._boss.getQueue(name).catch(() => null);
      if (!exists) throw err;
    }
  }

  async enqueue(queueName, data, opts = {}) {
    await this._ensureQueue(queueName, opts);
    const sendOpts = {
      retryLimit:   opts.retryLimit   ?? DEFAULT_RETRY.retryLimit,
      retryDelay:   opts.retryDelay   ?? DEFAULT_RETRY.retryDelay,
      retryBackoff: opts.retryBackoff ?? DEFAULT_RETRY.retryBackoff,
    };
    // expireInSeconds = ACTIVE-Timeout (pg-boss-Default 15 min reicht; Max 24h) → nur wenn explizit.
    if (opts.expireInSeconds) sendOpts.expireInSeconds = opts.expireInSeconds;
    // Idempotenz-Schlüssel (P_CORR): gleicher Input erzeugt keinen Doppeljob.
    if (opts.singletonKey) sendOpts.singletonKey = String(opts.singletonKey);

    const jobId = await this._boss.send(queueName, data ?? {}, sendOpts);
    this._counts.enqueued += 1;
    logger.info('queue_enqueued', { queueName, jobId });
    return jobId;
  }

  async registerWorker(queueName, handler, opts = {}) {
    await this._ensureQueue(queueName, opts);
    const workOpts = { batchSize: 1, includeMetadata: true };
    if (opts.pollingIntervalSeconds) workOpts.pollingIntervalSeconds = opts.pollingIntervalSeconds;

    // v12: Handler bekommt ein Array. batchSize:1 → genau ein Job, defensiv iterieren.
    await this._boss.work(queueName, workOpts, async (jobs) => {
      for (const job of jobs) {
        if (job.retryCount > 0) this._counts.retried += 1;
        logger.info('queue_processing', { queueName, jobId: job.id, retryCount: job.retryCount ?? 0 });
        try {
          await handler(job); // job: { id, name, data, retryCount, state, ... } — Processor nutzt id+data
          this._counts.completed += 1;
          logger.info('queue_processed', { queueName, jobId: job.id });
        } catch (err) {
          // WICHTIG: weiterwerfen → pg-boss zählt den Versuch als fehlgeschlagen und
          // retried/dead-lettert. Kein stiller Erfolg (kein swallow).
          this._counts.failed += 1;
          logger.error('queue_job_failed', { queueName, jobId: job.id, message: err.message });
          throw err;
        }
      }
    });
  }

  async start() {
    await this._boss.start();
    logger.info('pgboss_started');
  }

  async stop(opts = {}) {
    // graceful: laufende Jobs zu Ende bringen, dann Verbindung schließen.
    await this._boss.stop({ graceful: true, ...opts });
    logger.info('pgboss_stopped');
  }

  /**
   * Stabilitäts-/Queue-Stats. depth/running sind LIVE aus pg-boss (getQueueStats);
   * enqueued/completed/failed/retried sind Prozess-Zähler. oldestQueuedAgeMs ist über
   * die offizielle API nicht billig verfügbar → 0 (kein Fake). Fehler-sicher: ein
   * Introspektions-Fehler liefert neutrale Werte, kippt nie den Metrik-Scrape.
   */
  async stats() {
    let depth = 0;
    let running = 0;
    for (const name of this._queueNames) {
      try {
        const qs = await this._boss.getQueueStats(name);
        depth   += qs?.queuedCount ?? 0;
        running += qs?.activeCount ?? 0;
      } catch (err) {
        logger.debug('pgboss_queue_stats_failed', { name, message: err.message });
      }
    }
    return {
      depth,
      running,
      enqueued:  this._counts.enqueued,
      completed: this._counts.completed,
      failed:    this._counts.failed,
      retried:   this._counts.retried,
      oldestQueuedAgeMs: 0,
      retained:    0,
      maxRetained: 0,
    };
  }
}

module.exports = { PgBossQueueService, DEAD_LETTER_SUFFIX, DEFAULT_RETRY, buildPgBossConfig };
