'use strict';

/**
 * QueueService — Interface für Job-Queue-Implementierungen.
 *
 * IntegrationService kennt NUR dieses Interface — nie pg-boss direkt.
 * Dadurch bleibt die Architektur testbar und austauschbar.
 */
class QueueService {
  /**
   * Job in die Queue stellen.
   * @param {string} queueName
   * @param {object} data
   * @param {object} opts  - z.B. { retryLimit: 3, retryDelay: 30 }
   * @returns {Promise<string>} jobId
   */
  // eslint-disable-next-line no-unused-vars
  async enqueue(queueName, data, opts = {}) { this._ni('enqueue'); }

  /**
   * Worker registrieren — verarbeitet Jobs aus einer Queue.
   * @param {string}   queueName
   * @param {Function} handler   async (job) => void
   */
  // eslint-disable-next-line no-unused-vars
  async registerWorker(queueName, handler) { this._ni('registerWorker'); }

  /** Queue starten (Verbindung aufbauen, Worker aktivieren) */
  async start() { this._ni('start'); }

  /** Queue sauber beenden */
  async stop()  { this._ni('stop'); }

  /**
   * Stabilitäts-Stats (P_STABILITY_2): Tiefe/laufend/Alter + Zähler.
   * Default: neutrale Nullwerte — bewusst KEIN _ni, damit der Metrik-Collector
   * niemals crasht (Impls ohne Introspektion liefern einfach 0).
   */
  async stats() {
    return { depth: 0, running: 0, enqueued: 0, completed: 0, failed: 0, retried: 0, oldestQueuedAgeMs: 0, retained: 0, maxRetained: 0 };
  }

  _ni(m) { throw new Error(`QueueService.${m}() nicht implementiert`); }
}

// Queue-Namen — zentral definiert, nie als freie Strings in Code
const QUEUES = {
  INTEGRATION_PROCESS:  'integration.process',
  CORRELATION_PROCESS:  'correlation.process',  // P_CORR_1b: asynchrone Korrelation
};

module.exports = { QueueService, QUEUES };
