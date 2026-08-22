'use strict';

const { randomUUID } = require('crypto');
const { QueueService } = require('./QueueService');

/**
 * InMemoryQueueService — für Tests und lokale Entwicklung ohne echte DB-Queue.
 * Verarbeitet Jobs synchron im selben Prozess.
 *
 * P_STABILITY_2: Die Job-Liste ist jetzt BOUNDED (Ring, Drop-oldest) → kein
 * unbegrenztes RAM-Wachstum mehr. Statistik-Zähler (enqueued/completed/failed)
 * sind monoton und unabhängig vom Ring. Der produktive Pfad nutzt perspektivisch
 * die persistente Queue (siehe queueServiceFactory / ADR).
 */
const DEFAULT_MAX_RETAINED = 1000;

class InMemoryQueueService extends QueueService {
  constructor({ maxRetained = DEFAULT_MAX_RETAINED } = {}) {
    super();
    this._workers = new Map();  // queueName → handler
    this._jobs    = [];         // gespeicherte Jobs (BOUNDED — nur die letzten maxRetained)
    this._running = false;
    this._maxRetained    = Math.max(1, Number(maxRetained) || DEFAULT_MAX_RETAINED);
    this._enqueuedTotal  = 0;
    this._completedTotal = 0;
    this._failedTotal    = 0;
  }

  // Bounded: ältesten Job verwerfen, sobald die Obergrenze überschritten ist.
  _retain(job) {
    this._jobs.push(job);
    if (this._jobs.length > this._maxRetained) this._jobs.shift();
  }

  async enqueue(queueName, data, opts = {}) {
    const jobId = randomUUID();
    const job   = { id: jobId, name: queueName, data, opts, status: 'queued', createdAt: new Date().toISOString() };
    this._enqueuedTotal += 1;
    this._retain(job);

    // Worker synchron ausführen wenn vorhanden
    const handler = this._workers.get(queueName);
    if (handler && this._running) {
      job.status = 'processing';
      try {
        await handler(job);
        job.status = 'completed';
        this._completedTotal += 1;
      } catch (err) {
        job.status     = 'failed';
        job.failReason = err.message;
        this._failedTotal += 1;
      }
    }

    return jobId;
  }

  async registerWorker(queueName, handler) {
    this._workers.set(queueName, handler);
  }

  async start() { this._running = true; }
  async stop()  { this._running = false; }

  // Stabilitäts-Stats: Tiefe/laufend aus dem Ring; Fehler/abgeschlossen aus monotonen
  // Zählern (bound-unabhängig). oldestQueuedAgeMs = Alter des ältesten WARTENDEN Jobs
  // (bei synchroner Verarbeitung meist 0).
  async stats() {
    const now = Date.now();
    let depth = 0;
    let running = 0;
    let oldestQueuedAt = null;
    for (const j of this._jobs) {
      if (j.status === 'queued') {
        depth += 1;
        const t = Date.parse(j.createdAt);
        if (!Number.isNaN(t) && (oldestQueuedAt === null || t < oldestQueuedAt)) oldestQueuedAt = t;
      } else if (j.status === 'processing') {
        running += 1;
      }
    }
    return {
      depth,
      running,
      enqueued:  this._enqueuedTotal,
      completed: this._completedTotal,
      failed:    this._failedTotal,
      retried:   0, // InMemory verarbeitet synchron ohne Retry-Zustand
      oldestQueuedAgeMs: oldestQueuedAt === null ? 0 : Math.max(0, now - oldestQueuedAt),
      retained:    this._jobs.length,
      maxRetained: this._maxRetained,
    };
  }

  // Test-Hilfsmethoden
  getJobs(queueName)    { return this._jobs.filter(j => !queueName || j.name === queueName); }
  clearJobs()           { this._jobs = []; }
  getWorker(queueName)  { return this._workers.get(queueName); }
}

module.exports = { InMemoryQueueService, DEFAULT_MAX_RETAINED };
