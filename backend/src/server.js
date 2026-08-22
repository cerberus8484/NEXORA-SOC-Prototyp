'use strict';

// Fail fast: ENV-Validierung vor allem anderen
const { validateEnv } = require('./config/validateEnv');
validateEnv();

const app    = require('./app');
const config = require('./config');
const logger = require('./logger');

let server;
let imapPoller = null;
let crowdsecPoller = null;
let correlationRuntime = null;

/**
 * Startup-Bootstrap.
 * Bei aktivierter DB (config.db.enabled): Migrationen ausführen + Verbindung
 * prüfen, BEVOR der Server Requests annimmt. So läuft die Hunt/Ticket-API
 * gegen eine garantiert migrierte Postgres-Instanz (restart-fest).
 */
async function bootstrap() {
  // Event-Loop-Lag-Sampler starten (unref'd — hält den Prozess nicht am Leben).
  require('./metrics/eventLoopLag').eventLoopLagMonitor.start();

  // ADR-042 Arming-Blocker #1: Containment-Real-Exec-Readiness früh sichtbar machen.
  // Kein Boot-Abbruch (Runtime ist fail-closed) — nur ein lauter Hinweis, wenn der
  // echte Containment-Kanal scharf, die Mgmt-Preservation-Config aber fehlt/ungültig ist.
  {
    const { checkContainmentReadiness } = require('./threatHunting/containmentReadiness');
    const readiness = checkContainmentReadiness(config);
    if (readiness.armed) {
      if (readiness.issues.length > 0) {
        for (const issue of readiness.issues) logger.warn('containment_real_exec_misconfig', { issue });
      } else {
        logger.info('containment_real_exec_armed', { mgmtCidr: config.huntResponse.mgmtCidr });
      }
    }
  }

  if (config.db.enabled) {
    const { migrate, ping } = require('./db/pool');
    logger.info('db_bootstrap_start', { host: config.db.host, db: config.db.name });
    await migrate();
    const reachable = await ping();
    if (!reachable) throw new Error('DB ping fehlgeschlagen nach Migration');
    logger.info('db_bootstrap_done');

    // DB-Pool-Auslastung exportieren (Pools sind jetzt konstruiert). Nur bei aktiver
    // DB — ohne Postgres gibt es keine Pools, dann fehlen diese Gauges bewusst.
    const { registry }            = require('./metrics/metricsRegistry');
    const { registerPoolMetrics } = require('./metrics/poolMetrics');
    const { poolSnapshot }        = require('./db/poolStats');
    const { pool }                = require('./db/pool');
    const { healthPool }          = require('./db/healthPool');
    registerPoolMetrics(registry, {
      apiSnapshot:    () => poolSnapshot(pool),
      healthSnapshot: () => poolSnapshot(healthPool),
    });
  } else {
    logger.info('db_disabled', { note: 'InMemory-Repositories aktiv (DB_ENABLED!=true)' });
  }

  // Idempotenter Admin-Bootstrap (nur wenn ADMIN_EMAIL/ADMIN_PASSWORD gesetzt)
  const { ensureAdminFromEnv } = require('./services/bootstrapAdmin');
  await ensureAdminFromEnv();

  // Maintenance-Guard-Cache initialisieren — liest maintenanceMode aus dem
  // Settings-Store, damit der Wert nach einem Neustart erhalten bleibt.
  // Kein DB-Read pro Request — nur einmal beim Boot.
  const { refreshMaintenance }       = require('./middleware/maintenanceGuard');
  const { refreshTlsEnforce }        = require('./middleware/tlsGuard');
  const { refreshIpAllowlist }       = require('./middleware/ipAllowlistGuard');
  const { createSettingsRepository } = require('./repositories/settingsRepositoryFactory');
  const _settingsRepo = createSettingsRepository();
  await refreshMaintenance(_settingsRepo);
  // Zugriffskontroll-Caches aus dem Settings-Store füllen (bleiben nach Neustart erhalten).
  await refreshTlsEnforce(_settingsRepo);
  await refreshIpAllowlist(_settingsRepo);

  // Layer 2: in der UI gespeicherte Wazuh-Verbindung (DB > ENV) auf die
  // Singleton-Clients anwenden — bleibt so nach Neustart erhalten. Fehler sind
  // nicht fatal: die Clients laufen dann mit dem ENV-Stand weiter (sichtbar geloggt).
  const { applyWazuhConnection } = require('./integrations/adapters/wazuh/wazuhConnectionApplier');
  await applyWazuhConnection(_settingsRepo).catch((err) => {
    logger.error('wazuh_connection_apply_failed', { error: err.message, note: 'Clients laufen mit ENV-Konfiguration weiter' });
  });

  // Layer 2: in der UI gespeicherte Threat-Intel-Keys (DB > ENV) auf die Provider
  // anwenden. Fail-safe: bei Fehler laufen die Provider mit ENV-Keys weiter.
  const { applyThreatIntelKeys } = require('./integrations/threatIntel/threatIntelKeysApplier');
  await applyThreatIntelKeys(_settingsRepo).catch((err) => {
    logger.error('threat_intel_keys_apply_failed', { error: err.message, note: 'Provider laufen mit ENV-Keys weiter' });
  });

  // Layer 2: in der UI gespeicherte QRadar-Verbindung (DB > ENV) anwenden. Fail-safe auf ENV.
  const { applyQradarConnection } = require('./integrations/adapters/qradar/qradarConnectionApplier');
  await applyQradarConnection(_settingsRepo).catch((err) => {
    logger.error('qradar_connection_apply_failed', { error: err.message, note: 'Provider läuft mit ENV-Konfiguration weiter' });
  });

  // Layer 2: in der UI gespeicherte Qdrant-Verbindung (DB > ENV) anwenden. Fail-safe auf ENV.
  const { applyQdrantConnection } = require('./rag/qdrantConnectionApplier');
  await applyQdrantConnection(_settingsRepo).catch((err) => {
    logger.error('qdrant_connection_apply_failed', { error: err.message, note: 'RAG läuft mit ENV-Konfiguration weiter' });
  });

  // Layer 2: in der UI gespeicherte Outbound-Ticket-Verbindungen (ServiceNow/OTRS,
  // DB > ENV) auf die Singleton-Adapter anwenden. Fail-safe auf ENV.
  const { applyExternalTicketConnections } = require('./integrations/externalTicketConnectionApplier');
  await applyExternalTicketConnections(_settingsRepo).catch((err) => {
    logger.error('external_ticket_connections_apply_failed', { error: err.message, note: 'Outbound-Adapter laufen mit ENV-Konfiguration weiter' });
  });

  // Integration-Worker starten — ohne diesen bleiben eingehende Webhook-Events
  // in der Queue liegen und werden NIE zu Tickets.
  // Processor-Registry: source → Processor-Instanz. Conditional registration —
  // Nicht-Wazuh-Processor nur wenn zugehörige ENV gesetzt ist (kein Crash sonst).
  const { integrationService } = require('./integrations/IntegrationService');
  const { WazuhProcessor }     = require('./integrations/adapters/wazuh/WazuhProcessor');
  const { QRadarProcessor }    = require('./integrations/adapters/qradar/QRadarProcessor');
  const { SplunkProcessor }    = require('./integrations/adapters/splunk/SplunkProcessor');
  const { EmailProcessor }     = require('./integrations/adapters/email/EmailProcessor');
  const { wazuhApiClient }     = require('./integrations/adapters/wazuh/wazuhApiInstance');

  logger.info('wazuh_api_enrichment', { enabled: wazuhApiClient.isEnabled() });

  // Wazuh ist immer aktiv — primäre Quelle.
  const processorRegistry = {
    wazuh: new WazuhProcessor(undefined, { apiClient: wazuhApiClient }),
  };
  // QRadar/Curator-Ingest ist stateless und braucht fuer Webhooks keine Boot-ENV.
  // Die eigentliche Dashboard-/API-Verbindung kommt separat aus DB > ENV.
  processorRegistry.qradar = new QRadarProcessor();
  logger.info('integration_processor_registered', { source: 'qradar' });
  if (process.env.SPLUNK_HOST) {
    processorRegistry.splunk = new SplunkProcessor();
    logger.info('integration_processor_registered', { source: 'splunk', host: process.env.SPLUNK_HOST });
  }
  // E-Mail: Webhook-Pfad (POST /integrations/email/webhook) ist immer aktiv. Layer 2:
  // Processor IMMER registrieren (stateless Normalizer) — das IMAP-Postfach ist jetzt
  // UI-verwaltbar (DB > ENV), also darf der ingest('email',…)-Pfad nicht boot-ENV-gegatet sein.
  {
    processorRegistry.email = new EmailProcessor();
  }
  // CrowdSec: WAN-Alerts vom Webserver-CrowdSec → Ticket. Layer 2: Processor IMMER
  // registrieren (stateless Normalizer) — die Verbindung ist jetzt UI-verwaltbar
  // (DB > ENV), also darf der ingest('crowdsec',…)-Pfad nicht boot-ENV-gegatet sein.
  {
    const { CrowdsecProcessor } = require('./integrations/adapters/crowdsec/CrowdsecProcessor');
    processorRegistry.crowdsec = new CrowdsecProcessor();
  }

  await integrationService.startWorker(processorRegistry);

  // P_CORR_1c: Korrelations-Runtime starten — EINE Queue/Repo/Scheduler/Worker (geteilt).
  // Bei DB_ENABLED=true wählt die Factory die persistente pg-boss-Queue; ein Startfehler
  // propagiert hier SICHTBAR (bootstrap schlägt fehl) — KEIN stiller InMemory-Fallback.
  const { getCorrelationRuntime } = require('./correlation/correlationRuntime');
  correlationRuntime = getCorrelationRuntime();
  await correlationRuntime.start();

  // Queue-Tiefe/laufend/Alter exportieren (P_STABILITY_2). Immer aktiv — die Queue
  // existiert in beiden Modi; liest beim Scrape aus integrationService.queueStats().
  {
    const { registry }             = require('./metrics/metricsRegistry');
    const { registerQueueMetrics } = require('./metrics/queueMetrics');
    registerQueueMetrics(registry, { stats: () => integrationService.queueStats() });
  }

  // IMAP-Poller. Layer 2: IMMER starten (kein Boot-ENV-Gate mehr). Config wird pro
  // Zyklus aus DB > ENV aufgelöst; unkonfiguriert → self-skip ohne Netzwerk. So greift
  // eine UI-Änderung (PUT /imap/connection) beim nächsten Poll-Zyklus ohne Neustart.
  // Referenz behalten → beim Shutdown sauber stoppen.
  {
    const { ImapPoller } = require('./integrations/adapters/email/imapPoller');
    imapPoller = new ImapPoller(integrationService, { settingsRepo: _settingsRepo });
    imapPoller.start();
  }

  // Optionaler CrowdSec-LAPI-Poller (zieht WAN-Alerts vom Webserver-CrowdSec).
  // Layer 2: Poller IMMER starten (kein Boot-ENV-Gate mehr). Config wird pro Zyklus
  // aus DB > ENV aufgelöst; unkonfiguriert → self-skip ohne Netzwerk. So greift eine
  // UI-Änderung (PUT /crowdsec/connection) beim nächsten Poll-Zyklus ohne Neustart.
  {
    const { CrowdsecPoller } = require('./integrations/adapters/crowdsec/crowdsecPoller');
    crowdsecPoller = new CrowdsecPoller(integrationService, { settingsRepo: _settingsRepo });
    crowdsecPoller.start();
  }

  server = app.listen(config.port, () => {
    logger.info('server_started', {
      port: config.port,
      env:  config.env,
      api:  `http://localhost:${config.port}${config.api.prefix}`,
      db:   config.db.enabled ? 'postgres' : 'in-memory',
    });
  });

  // Ordentliches Herunterfahren registrieren (nach dem Listen — alle Refs gesetzt).
  registerGracefulShutdown(integrationService);
}

bootstrap().catch((err) => {
  logger.error('server_bootstrap_failed', { message: err.message, stack: err.stack });
  process.exit(1);
});

// Graceful Shutdown — schließt ALLES geordnet: HTTP-Server → Poller → Worker/Queue
// → DB-Pools (API + Health) → Event-Loop-Sampler. Fehler-isoliert + zeitbegrenzt
// (createGracefulShutdown). So beendet sich der Container kontrolliert statt durch
// Host-OOM/Kill überrascht zu werden.
function registerGracefulShutdown(integrationService) {
  const closers = [
    // 1. Keine neuen Requests mehr annehmen.
    { name: 'http-server', close: () => new Promise((resolve) => {
      if (server && server.listening) server.close(() => resolve());
      else resolve();
    }) },
    // 2. Hintergrund-Produzenten stoppen (keine neuen Events mehr).
    { name: 'imap-poller',     close: () => { if (imapPoller) imapPoller.stop(); } },
    { name: 'crowdsec-poller', close: () => { if (crowdsecPoller) crowdsecPoller.stop(); } },
    // 3. Worker/Queue stoppen.
    { name: 'integration-worker', close: () => integrationService.stopWorker() },
    { name: 'correlation-worker', close: () => (correlationRuntime ? correlationRuntime.stop() : undefined) },
    // 4. DB-Pools schließen — NACH dem Worker (er nutzt die DB).
    { name: 'api-pool',    close: () => (config.db.enabled ? require('./db/pool').pool.end() : undefined) },
    { name: 'health-pool', close: () => (config.db.enabled ? require('./db/healthPool').healthPool.end() : undefined) },
    // 5. Metrics-Event-Loop-Sampler beenden.
    { name: 'eventloop-sampler', close: () => require('./metrics/eventLoopLag').eventLoopLagMonitor.close() },
  ];

  const { createGracefulShutdown } = require('./lifecycle/gracefulShutdown');
  const { shutdown } = createGracefulShutdown({
    closers,
    logger,
    timeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '10000', 10),
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = { bootstrap };
