'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Entrypoint für den EIGENSTÄNDIGEN Korrelations-Worker-Container.
//
// Gleiches Image wie die API, anderer Befehl:
//     node src/correlationWorkerMain.js
//
// Warum eigener Container (Deployment-Phase 2):
//   • Worker-Neustart ohne API-Downtime (und umgekehrt)
//   • saubere Fehler-Isolation: ein hängender Job reißt nicht die API mit
//   • unabhängig skalierbar (mehrere Worker auf EINER Queue)
//   • Korrelations-Last ist im Monitoring getrennt sichtbar
//
// Rollen-Aufteilung (siehe correlationRuntime.js):
//   • API-Container    → CORRELATION_WORKER_ENABLED=false: plant nur (Schedule-on-Read)
//   • DIESER Container → verarbeitet die Jobs
//
// Dieser Prozess startet KEINEN HTTP-Server und führt KEINE Migrationen aus —
// das bleibt Sache der API (genau ein Migrations-Pfad, kein Wettlauf).
// ─────────────────────────────────────────────────────────────────────────

const { validateEnv } = require('./config/validateEnv');
validateEnv();

const logger = require('./logger');
const { buildCorrelationRuntime, buildTicketsAdapter } = require('./correlation/correlationRuntime');

async function main() {
  // Der Worker-Container verarbeitet IMMER — unabhängig von CORRELATION_WORKER_ENABLED.
  // Diese Variable steuert nur, ob der API-Prozess zusätzlich verarbeitet.
  const { ticketService } = require('./services/TicketService');
  const { RuntimeConfigProvider } = require('./applyChannel/RuntimeConfigProvider');
  const { WorkerStatusReporter }  = require('./applyChannel/WorkerStatusReporter');
  const { getApplyRepository }        = require('./applyChannel/applyRepositoryFactory');
  const { getWorkerStatusRepository } = require('./applyChannel/workerStatusRepositoryFactory');

  // Bei DB_ENABLED=true zuerst sicherstellen, dass die DB wirklich erreichbar ist —
  // sonst startet der Worker scheinbar erfolgreich und verarbeitet nie etwas.
  if (String(process.env.DB_ENABLED || '').toLowerCase() === 'true') {
    const { ping } = require('./db/pool');
    await ping();
    logger.info('correlation_worker_db_ready');
  }

  const runtime = buildCorrelationRuntime({
    tickets: buildTicketsAdapter(ticketService),
    configProvider: new RuntimeConfigProvider({ applyRepo: getApplyRepository() }),
    statusReporter: new WorkerStatusReporter({ repo: getWorkerStatusRepository(), workerId: 'correlation-worker' }),
    enableWorker: true,
  });

  await runtime.start();
  logger.info('correlation_worker_container_started', { queue: runtime.queueName });

  // Sauberes Herunterfahren: laufenden Job zu Ende bringen lassen, dann Queue schließen.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('correlation_worker_shutdown', { signal });
    try {
      await runtime.stop();
    } catch (err) {
      logger.error('correlation_worker_shutdown_failed', { error: err.message });
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });

  return runtime;
}

// Nur ausführen, wenn direkt gestartet (nicht beim Import im Test).
if (require.main === module) {
  main().catch((err) => {
    // Fail-fast + SICHTBAR: ein Worker, der nicht startet, darf nicht still im
    // Container hängen — sonst korreliert niemand und es fällt (wieder) nicht auf.
    logger.error('correlation_worker_start_failed', { error: err && err.message });
    process.exit(1);
  });
}

module.exports = { main };
