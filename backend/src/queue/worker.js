'use strict';

const { QUEUES }             = require('./QueueService');
const { IntegrationProcessor } = require('../integrations/IntegrationProcessor');
const { WazuhProcessor }     = require('../integrations/adapters/wazuh/WazuhProcessor');
const { CrowdsecProcessor }  = require('../integrations/adapters/crowdsec/CrowdsecProcessor');
const logger                 = require('../logger');

/**
 * Worker-Registrierung.
 *
 * Wird in server.js aufgerufen nachdem queueService.start() läuft.
 * Registriert alle Worker-Handler für bekannte Queues.
 *
 * @param {QueueService}              queueService
 * @param {InMemoryIntegrationRepository|PostgresIntegrationRepository} integrationRepo
 */
async function registerWorkers(queueService, integrationRepo) {
  // Processor-Registry: macht aus normalisierten Events Tickets (Dedup inkl.).
  // Wazuh aktiv; QRadar/Splunk folgen demselben Muster.
  const processorRegistry = {
    wazuh:    new WazuhProcessor(),
    crowdsec: new CrowdsecProcessor(),   // WAN-Alerts vom Webserver-CrowdSec → Ticket
  };
  const processor = new IntegrationProcessor(integrationRepo, processorRegistry);

  // Worker: Integration Events verarbeiten
  await queueService.registerWorker(
    QUEUES.INTEGRATION_PROCESS,
    async (job) => {
      logger.info('worker_start', { queue: QUEUES.INTEGRATION_PROCESS, jobId: job.id });
      await processor.process(job);
    }
  );

  logger.info('workers_registered', { queues: Object.values(QUEUES) });
}

module.exports = { registerWorkers };
