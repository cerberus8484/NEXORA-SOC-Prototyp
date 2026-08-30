'use strict';

const { IntegrationEvent, KNOWN_SOURCES } = require('./IntegrationEvent');
const { WebhookAdapter }                  = require('./WebhookAdapter');
const { QRadarAdapter }                   = require('./adapters/qradar/QRadarAdapter');
const { SplunkAdapter }                   = require('./adapters/splunk/SplunkAdapter');
const { WazuhAdapter }                    = require('./adapters/wazuh/WazuhAdapter');
const { EmailAdapter }                    = require('./adapters/email/EmailAdapter');
const { CrowdsecAdapter }                 = require('./adapters/crowdsec/CrowdsecAdapter');
const { InMemoryIntegrationRepository }   = require('../repositories/IntegrationRepository');
const { auditService, AUDIT_ACTIONS }     = require('../services/AuditService');
const { NotFoundError }                   = require('../errors/AppError');
const { InMemoryQueueService }            = require('../queue/InMemoryQueueService');
const { QUEUES }                          = require('../queue/QueueService');
const { metrics }                         = require('../metrics/metricsRegistry');
const logger                              = require('../logger');

// Adapter-Registry — Adapter pro Quelle
// QRadar nutzt dedizierten Adapter, alle anderen den generischen WebhookAdapter
const ADAPTER_REGISTRY = {
  ...Object.fromEntries(KNOWN_SOURCES.map(s => [s, new WebhookAdapter(s)])),
  qradar: new QRadarAdapter(),   // P10 ✅
  splunk: new SplunkAdapter(),   // P11 ✅
  wazuh:  new WazuhAdapter(),    // P15 ✅
  email:  new EmailAdapter(),    // E-Mail-Intake ✅
  crowdsec: new CrowdsecAdapter(), // WAN-Alerts vom Webserver-CrowdSec (LAPI-Poller)
};

class IntegrationService {
  constructor(repository = null, queueService = null) {
    this._repo         = repository    || new InMemoryIntegrationRepository();
    this._queue        = queueService  || new InMemoryQueueService();
    this._adapters     = ADAPTER_REGISTRY;
    this._workerStarted = false;
  }

  /**
   * Worker auf der eigenen Queue registrieren + starten.
   * Muss beim App-Start aufgerufen werden — sonst bleiben eingehende Events
   * in der Queue liegen und werden nie zu Tickets verarbeitet.
   * @param {object} processorRegistry — source → Processor mit process(normalizedData)
   */
  async startWorker(processorRegistry = {}) {
    if (this._workerStarted) return;
    const { IntegrationProcessor } = require('./IntegrationProcessor');
    const { QUEUES } = require('../queue/QueueService');
    const processor = new IntegrationProcessor(this._repo, processorRegistry);

    // Worker-Wrapper macht Hintergrundarbeit sichtbar (laufend/verarbeitet/letzter Erfolg);
    // Queue-Verhalten (Retry/Status) bleibt unverändert — Fehler wird weitergeworfen.
    const { instrumentJob } = require('../metrics/instrumentJob');
    const handler = instrumentJob((job) => processor.process(job), {
      inFlight:    metrics.integrationJobsInFlight,
      processed:   metrics.integrationJobsProcessedTotal,
      lastSuccess: metrics.integrationLastSuccessTimestamp,
    });
    await this._queue.registerWorker(QUEUES.INTEGRATION_PROCESS, handler);
    await this._queue.start();
    this._workerStarted = true;
    logger.info('integration_worker_started', { sources: Object.keys(processorRegistry) });
    return processor;
  }

  /**
   * Worker/Queue sauber stoppen (Graceful Shutdown). No-Op, wenn nie gestartet.
   */
  async stopWorker() {
    if (!this._workerStarted) return;
    await this._queue.stop();
    this._workerStarted = false;
    logger.info('integration_worker_stopped');
  }

  /** Queue-Stabilitäts-Stats (Tiefe/laufend/Alter) für die Metriken (P_STABILITY_2). */
  async queueStats() {
    return this._queue.stats();
  }

  /**
   * Eingehenden Webhook-Payload verarbeiten.
   * Liest sich wie ein Ablaufplan — Details in privaten Methoden.
   */
  async ingest(source, rawPayload, { ip = '' } = {}) {
    const adapter = this._checkSource(source);
    const event   = IntegrationEvent.create({ source, rawPayload, ip });

    try {
      if (await this._isDuplicate(event, ip)) {
        return { status: 'duplicate', eventId: event.id };
      }

      await this._normalizeWithAdapter(event, adapter);
      await this._saveAndQueue(event);
      await this._auditAccepted(event, ip);

      // P20: Prometheus — eingehende Wazuh-Alerts (akzeptiert, kein Duplikat).
      if (source === 'wazuh') metrics.wazuhAlertsIngestedTotal.inc();

      return { status: 'accepted', eventId: event.id, normalizedData: event.normalizedData };

    } catch (err) {
      await this._auditRejected(event, err, ip);
      throw err;
    }
  }

  // ── Private Pipeline-Schritte ──────────────────────────

  _checkSource(source) {
    const adapter = this._adapters[source];
    if (!adapter) throw new NotFoundError(`Unbekannte Integrationsquelle: ${source}`);
    return adapter;
  }

  async _isDuplicate(event, ip) {
    const existing = await this._repo.findByDeduplicationKey(event.deduplicationKey);
    if (!existing) return false;

    event.status          = 'duplicate';
    event.rejectionReason = `Duplikat: ${event.deduplicationKey} bereits vorhanden`;
    await this._repo.save(event);
    // Datenminimierung: Duplikat-Erkennung ist Pipeline-Telemetrie → nur Log.
    logger.info('integration_duplicate', { eventId: event.id, source: event.source });
    return true;
  }

  async _normalizeWithAdapter(event, adapter) {
    adapter.validate(event.rawPayload);
    event.normalizedData = adapter.normalize(event.rawPayload);
    event.status         = 'normalized';
    event.processedAt    = new Date().toISOString();
    await this._repo.save(event);
  }

  async _saveAndQueue(event) {
    event.status = 'queued';
    await this._repo.save(event);
    await this._queue.enqueue(QUEUES.INTEGRATION_PROCESS, { eventId: event.id });
  }

  async _auditAccepted(event, ip) {
    // Datenminimierung: jede akzeptierte Ingestion ist Pipeline-Telemetrie
    // (steht im Wazuh-Indexer) → nur strukturiertes Log, nicht ins audit_log.
    logger.info('integration_accepted', { eventId: event.id, source: event.source });
  }

  async _auditRejected(event, err, ip) {
    event.status          = 'rejected';
    event.rejectionReason = err.message;
    event.processedAt     = new Date().toISOString();
    await this._repo.save(event);
    await auditService.write({
      action: 'INTEGRATION_REJECTED',
      targetType: 'integration_event', targetId: event.id,
      metadata: { source: event.source, reason: err.message }, ip,
    });
  }

  getAdapter(source) { return this._adapters[source] || null; }
}

const integrationService = new IntegrationService();
module.exports = { IntegrationService, integrationService, KNOWN_SOURCES };
