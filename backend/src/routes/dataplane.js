'use strict';

// Data-Plane-Ingress — die Naht Korrelierungs-Engine → Nexora (ADR-035 §8).
// Der Outbox-Worker POSTet fusionierte Cross-Domain-Vorfälle hierher. Eigener,
// isolierter Pfad (berührt die Live-Integration-Pipeline NICHT). HMAC-gesichert,
// idempotent über die stabile incidentId.
const { Router } = require('express');
const { verifyWebhookSignature } = require('../integrations/hmac');
const { DataplaneIncidentAdapter } = require('../integrations/adapters/dataplane/DataplaneIncidentAdapter');
const { shouldEscalate } = require('../integrations/adapters/dataplane/verdictEscalation');
const { ticketService } = require('../services/TicketService');
const { dataplaneStatusSnapshotSchema } = require('../domain/validation/dataplaneStatusSchema');
const { getDataplaneStatusRepository } = require('../repositories/dataplaneStatusRepositoryFactory');
const { UnauthorizedError, ValidationError } = require('../errors/AppError');
const logger = require('../logger');

const router = Router();
const adapter = new DataplaneIncidentAdapter();

function getSecret() {
  return process.env.WEBHOOK_SECRET_DATAPLANE || null;
}

/**
 * POST /api/v1/dataplane/incidents
 *   202 — Vorfall angenommen, Ticket erstellt
 *   200 — Duplikat (incidentId existiert bereits) → idempotent ignoriert
 *   400 — Ungültiger FusedIncident
 *   401 — Fehlende/ungültige Signatur oder kein Secret konfiguriert
 */
router.post('/incidents', async (req, res, next) => {
  const secret = getSecret();
  if (!secret) return next(new UnauthorizedError('Kein WEBHOOK_SECRET_DATAPLANE konfiguriert'));
  try {
    verifyWebhookSignature(req, secret);
  } catch (err) {
    return next(err);
  }

  try {
    adapter.validate(req.body);                       // 400 bei ungültigem Vorfall
    const incidentId = req.body.incidentId;
    const draft = adapter.toTicketDraft(adapter.normalize(req.body));

    const existing = await ticketService.findOpenByOffense('dataplane', incidentId);
    if (existing) {
      // Idempotent — AUSSER der Vorfall ist durch neue Cross-Domain-Signale gestiegen:
      // dann das bestehende Ticket hochstufen (Verdikt/Severity + reichere Felder),
      // ohne Analyst-Endurteile oder den Bearbeitungszustand anzutasten.
      if (shouldEscalate(existing, draft)) {
        await ticketService.update(existing.id, {
          priority: draft.priority, decision: draft.decision, title: draft.title,
          description: draft.description, iocs: draft.iocs, mitre: draft.mitre, confidence: draft.confidence,
          srcIp: draft.srcIp, dstIp: draft.dstIp, attackerIp: draft.attackerIp,
          port: draft.port, protocol: draft.protocol, bytesSent: draft.bytesSent, bytesRecv: draft.bytesRecv,
          // Reichere Sitzungs-Aktivität mit-hochstufen (nur wenn vorhanden — kein Leeren).
          ...(Array.isArray(draft.payloads) && draft.payloads.length ? { payloads: draft.payloads } : {}),
        });
        logger.info('dataplane_incident_escalated', { incidentId, ticketId: existing.id, from: existing.priority, to: draft.priority, verdict: req.body.verdict });
        return res.status(200).json({ status: 'escalated', incidentId, ticketId: existing.id, from: existing.priority, to: draft.priority, requestId: req.id });
      }
      return res.status(200).json({ status: 'duplicate', incidentId, ticketId: existing.id, requestId: req.id });
    }

    // Anti-Flood: reines observed-Rauschen desselben (Quelle→Ziel) churnt die incidentId
    // pro Zeitfenster → ohne Aggregation entstehen N identische Tickets (Honeypot-Scan-Flut).
    // EIN offenes Ticket pro (srcIp,dstIp,category) führen, alert_count hochzählen. Nur für
    // observed — echte Incidents (suspicious/confirmed) behalten ihr eigenes Ticket.
    if (req.body.verdict === 'observed' && draft.srcIp && draft.dstIp) {
      const agg = await ticketService.findOpenByEndpoints('dataplane', {
        srcIp: draft.srcIp, dstIp: draft.dstIp, category: draft.category,
      });
      if (agg) {
        const alertCount = (agg.alertCount || 1) + 1;
        await ticketService.update(agg.id, { alertCount });
        logger.info('dataplane_incident_aggregated', { incidentId, ticketId: agg.id, alertCount });
        return res.status(200).json({ status: 'aggregated', incidentId, ticketId: agg.id, alertCount, requestId: req.id });
      }
    }

    const ticket = await ticketService.create(draft);
    logger.info('dataplane_incident_ingested', { incidentId, ticketId: ticket.id, verdict: req.body.verdict });
    return res.status(202).json({ status: 'accepted', incidentId, ticketId: ticket.id, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/dataplane/status — Hub↔Backend-Status-Brücke.
 *   Der Push-Job des Dataplane-Knotens meldet hier periodisch den letzten
 *   Live-Status (Collector-Hub + Intake-/Outbox-Zähler). HMAC-gesichert,
 *   upsert je nodeId (nur „last known"). KEINE Tickets, keine Seiteneffekte.
 *
 *   202 — Snapshot übernommen
 *   400 — Ungültiger Snapshot
 *   401 — Fehlende/ungültige Signatur oder kein Secret konfiguriert
 */
router.post('/status', async (req, res, next) => {
  const secret = getSecret();
  if (!secret) return next(new UnauthorizedError('Kein WEBHOOK_SECRET_DATAPLANE konfiguriert'));
  try {
    verifyWebhookSignature(req, secret);
  } catch (err) {
    return next(err);
  }

  const { error, value } = dataplaneStatusSnapshotSchema.validate(req.body, { stripUnknown: true, convert: true });
  if (error) return next(new ValidationError(error.message));

  try {
    const repo = getDataplaneStatusRepository();
    await repo.upsert(value.nodeId, value);
    logger.info('dataplane_status_received', { nodeId: value.nodeId, collectors: (value.collectors || []).length });
    return res.status(202).json({ status: 'accepted', nodeId: value.nodeId, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
