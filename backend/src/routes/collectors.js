'use strict';

/**
 * Route /api/v1/collectors — read-only Sicht auf die Ingestion-Aktivität je Quelle/Kollektor.
 *
 * EHRLICHKEIT (ADR-009): Es wird NUR echte, im Backend vorhandene Aktivität gezeigt —
 * pro `source` die Ticket-Aktivität (total, letzte 24h, last-seen). Das beantwortet
 * „kommt von Quelle/Kollektor X echt was an und wann zuletzt?".
 *
 * LIVE-Prozessstatus (running/failed/throughput) des Collector-Hubs lebt im
 * Dataplane-Knoten und wird über die Hub↔Backend-Status-Brücke (POST /dataplane/status)
 * gemeldet. `liveProcessStatus.available` wird ehrlich =true, sobald ein FRISCHER
 * Snapshot vorliegt — sonst bleibt es false (nichts erfunden).
 */

const { Router } = require('express');
const { requireAuth } = require('../middleware/authenticate');
const { createTicketRepository } = require('../repositories/ticketRepositoryFactory');
const { getDataplaneStatusRepository } = require('../repositories/dataplaneStatusRepositoryFactory');
const { summarizeDataplaneStatus } = require('../services/dataplaneStatusView');

function compactNode(node) {
  return {
    nodeId: node.nodeId,
    health: node.health,
    fresh: node.fresh,
    ageMs: node.ageMs,
    reportedAt: node.reportedAt ?? null,
    collectors: node.collectorsSummary,
  };
}

function createCollectorsRouter({ ticketRepo, statusRepo } = {}) {
  const router = Router();
  const repo = ticketRepo || createTicketRepository();
  const dpStatusRepo = statusRepo || getDataplaneStatusRepository();

  // GET /api/v1/collectors/activity — Ingestion-Aktivität je Quelle (echte Ticket-Daten)
  // + ehrlicher Live-Prozessstatus aus der Status-Brücke (falls frisch).
  router.get('/activity', requireAuth, async (req, res, next) => {
    try {
      const sources = await repo.ingestActivityBySource({ windowHours: 24 });
      const summary = summarizeDataplaneStatus(await dpStatusRepo.list());
      const liveProcessStatus = summary.available
        ? {
          available: true,
          freshNodes: summary.aggregate.freshNodes,
          nodes: summary.nodes.filter((n) => n.fresh).map(compactNode),
        }
        : {
          available: false,
          note: 'Live-Prozessstatus des Collector-Hubs (running/failed) erfordert einen frischen Snapshot über die Hub↔Backend-Status-Brücke — derzeit keiner vorhanden.',
        };
      res.json({ data: { sources, liveProcessStatus }, requestId: req.id });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/collectors/pipeline — vollständige Dataplane-Pipeline-Sicht
  // (Collector-Hub-Zustände + aggregierte Intake-/Outbox-Zähler) für die UI.
  router.get('/pipeline', requireAuth, async (req, res, next) => {
    try {
      const summary = summarizeDataplaneStatus(await dpStatusRepo.list());
      res.json({ data: summary, requestId: req.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

const router = createCollectorsRouter();
module.exports = router;
module.exports.createCollectorsRouter = createCollectorsRouter;
