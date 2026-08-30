'use strict';

const { auditService }    = require('../services/AuditService');
const logger              = require('../logger');

const MAX_RETRIES = 3;

/**
 * IntegrationProcessor — Worker-Logik für Integration Events.
 *
 * Wird vom Worker aufgerufen, kennt kein HTTP.
 * Verarbeitet ein IntegrationEvent aus der Queue.
 *
 * Aktuell: Status setzen + Audit.
 * Später (P10+): QRadar/Splunk/ServiceNow-spezifische Logik.
 */
class IntegrationProcessor {
  constructor(integrationRepository, processorRegistry = {}) {
    this._repo       = integrationRepository;
    // source → Processor mit process(normalizedData) → { action, ticketId }
    this._processors = processorRegistry;
  }

  /**
   * Job aus Queue verarbeiten.
   * @param {object} job  — pg-boss Job mit { id, data: { eventId } }
   */
  async process(job) {
    const { eventId } = job.data || {};
    if (!eventId) {
      logger.warn('integration_processor_missing_eventId', { jobId: job.id });
      return;
    }

    const event = await this._repo.findById
      ? await this._repo.findById(eventId)
      : (await this._repo.findAll()).find(e => e.id === eventId);

    if (!event) {
      logger.warn('integration_processor_event_not_found', { eventId });
      return;
    }

    // Status → processing
    event.status = 'processing';
    await this._repo.save(event);

    try {
      // Datenminimierung: Pipeline-Lebenszyklus (queued/processed/duplicate) NICHT
      // ins audit_log — das ist Betriebs-Telemetrie (stdout-Log), kein
      // Accountability-Ereignis. Nur Sicherheits-relevantes (FAILED/REJECTED) bleibt.

      // Source-spezifischer Processor: macht aus dem Event ein Ticket (Dedup inkl.)
      const processor = this._processors[event.source];
      let ticketResult = null;
      if (processor && processor.process) {
        ticketResult = await processor.process(event.normalizedData);
        if (ticketResult?.ticketId) event.ticketId = ticketResult.ticketId;
      }

      // Status → ticket_created nur wenn wirklich ein Ticket entstand
      // (z.B. 'skipped' wegen Level-Filter zählt nicht).
      event.status      = ticketResult?.ticketId ? 'ticket_created' : 'processed';
      event.processedAt = new Date().toISOString();
      await this._repo.save(event);

      logger.info('integration_processed', { eventId, source: event.source, ticketId: ticketResult?.ticketId, action: ticketResult?.action });

    } catch (err) {
      const attempt = (job.retryCount || 0) + 1;
      const isFinal = attempt >= MAX_RETRIES;

      event.status          = isFinal ? 'failed' : 'queued'; // zurück in Queue wenn nicht final
      event.rejectionReason = err.message;
      await this._repo.save(event);

      // Nur finale Fehler ins Audit (sicherheits-/betriebsrelevant); Retries nur loggen.
      if (isFinal) {
        await auditService.write({
          action:    'INTEGRATION_FAILED',
          targetType: 'integration_event',
          targetId:   event.id,
          metadata:  { source: event.source, error: err.message, attempt },
        });
      } else {
        logger.info('integration_retry', { eventId, source: event.source, error: err.message, attempt });
      }

      logger.error('integration_processing_error', {
        eventId,
        error:   err.message,
        attempt,
        isFinal,
      });

      // Fehler weiterwerfen damit pg-boss Retry auslöst
      if (!isFinal) throw err;
    }
  }
}

module.exports = { IntegrationProcessor };
