'use strict';

// P4: Route ist nur noch HTTP-Layer
// Validierung → validate() Middleware
// Business Logic → TicketService
// Keine direkte Datenhaltung hier

const { Router } = require('express');
const validate                        = require('../middleware/validate');
const { requireAuth, requireRole }    = require('../middleware/authenticate');
const { ticketService }               = require('../services/TicketService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { getCorrelationRuntime } = require('../correlation/correlationRuntime');
const { correlationMutationService } = require('../correlation/CorrelationMutationService');
const { computeInputHash } = require('../correlation/correlationJobDomain');
const {
  createTicketSchema,
  updateTicketSchema,
  listTicketsSchema,
  idTicketsSchema,
  importRawSchema,
  exportTicketSchema,
  bulkDeleteTicketsSchema,
} = require('../domain/validation/ticketSchema');
const config = require('../config');
const { externalTicketService } = require('../integrations/externalTicketInstance');
const { smartParse, parsedToEvidence } = require('../domain/smartParse');
const { buildNetworkCorrelation, collectGaps } = require('../correlation/networkCorrelation');
const { buildHoneypotSessions } = require('../correlation/honeypotSessionCorrelation');
const { buildExposureCorrelations } = require('../correlation/honeypotExposureCorrelation');
const { createInventoryLookupCache } = require('../correlation/inventoryLookupCache');
const { enrichFlowsWithDnsFqdn } = require('../correlation/flowFqdnEnrichment');
const { fqdnResolver, FQDN_ENABLED, FQDN_DOMAIN } = require('../correlation/fqdnResolverInstance');
const { wazuhIndexerClient } = require('../integrations/adapters/wazuh/wazuhIndexerInstance');
const { wazuhApiClient }     = require('../integrations/adapters/wazuh/wazuhApiInstance');
const { threatIntelService } = require('../integrations/threatIntel/threatIntelInstance');
const { buildTicketThreatIntel } = require('../correlation/ticketThreatIntel');
const { isPublicIp } = require('../integrations/threatIntel/ipClass');
const { collectEndpointEvidence } = require('../integrations/adapters/wazuh/wazuhEvidenceCollector');
const { evidenceService } = require('../services/EvidenceService');
const { notificationService } = require('../services/NotificationService');
const logger = require('../logger');
const fpExceptionRoutes = require('./fpException');

// CE-4.3: ein Inventory-Cache pro Prozess (TTL 5min) — füttert die Flow-Anreicherung
// (Host/MAC/Host-Interface) in der Timeline-Route, ohne pro Request viele API-Calls.
const inventoryLookupCache = createInventoryLookupCache({ client: wazuhApiClient });

const router = Router();

// IP-Indikatoren eines Tickets sammeln (srcIp/dstIp + IP-Zeilen im iocs-Feld), dedupliziert.
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
function ticketIps(ticket) {
  const ips = new Set();
  [ticket.srcIp, ticket.dstIp].forEach((v) => { if (v && IPV4.test(String(v).trim())) ips.add(String(v).trim()); });
  (ticket.iocs || '').split(/[\n,]/).map((s) => s.trim()).forEach((v) => { if (IPV4.test(v)) ips.add(v); });
  return [...ips];
}

// ── GET /api/v1/tickets ────────────────────────────────────
router.get('/', requireAuth, validate(listTicketsSchema, 'query'), async (req, res, next) => {
  try {
    const result = await ticketService.findAll(req.validatedQuery || req.query);
    res.json({ ...result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tickets/ids ────────────────────────────────
// Nur die IDs der gefilterten Tickets („alle gefilterten auswählen"). Höheres limit
// (bis 5000) als die Liste (max 500), da nur IDs zurückkommen. VOR '/:id' registriert.
router.get('/ids', requireAuth, validate(idTicketsSchema, 'query'), async (req, res, next) => {
  try {
    const result = await ticketService.findIds(req.validatedQuery || req.query);
    res.json({ ...result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tickets/:id ────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    res.json({ data: ticket, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tickets/:id/evidence — strukturierte Forensik-Felder ──
// Correlation Engine: normalisiert das Ticket (quellenabhängig) und führt es
// bei einem Case mit der Evidence seiner Child-Offenses zusammen. So zeigt
// ein Host-Case Inventar + korrelierte Flows/Prozesse, nicht ein leeres Deck.
router.get('/:id/evidence', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });
    const runtime = getCorrelationRuntime();
    const sourceRevision = String(ticket.updatedAt || '');
    const inputHash = computeInputHash({ ticketId: ticket.id, sourceRevision });
    const [activeJob, result] = await Promise.all([
      runtime.repo.findActiveJobByInputHash(inputHash),
      runtime.repo.findLatestResultByTicket(ticket.id),
    ]);
    let status = activeJob
      ? activeJob.status
      : (result ? (result.inputHash === inputHash ? 'current' : 'superseded') : 'unavailable');

    // Lazy Schedule-on-Read: wurde das Ticket nie korreliert (kein Job, kein Result),
    // JETZT einen Job planen — sonst läuft die reiche Engine (normalizeWazuhEvidence
    // parst ticket.logs → Prozess/Command/FIM/Netzwerk) für frisch erzeugte Tickets nie
    // an und das Deck bliebe leer. Idempotent (input_hash) + defensiv: ein Scheduling-
    // Fehler darf den Read NIE brechen (Lesepfad bleibt 200).
    if ((status === 'unavailable' || status === 'superseded') && runtime.scheduler) {
      try {
        await runtime.scheduler.schedule({ ticketId: ticket.id, sourceRevision, reason: 'read' });
        status = 'pending';
      } catch (err) {
        logger.warn('correlation_schedule_on_read_failed', { ticketId: ticket.id, error: err.message });
      }
    }
    res.json({
      data: result ? result.result : null,
      source: ticket.source,
      correlation: {
        status,
        result: result ? result.result : null,
        resultCreatedAt: result ? result.createdAt : null,
        sourceRevision,
        lastFailureReason: activeJob && activeJob.status === 'failed' ? activeJob.failureReason : null,
      },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tickets/:id/history — Ticket-Historie aus dem Audit-Log ──
// Read-only: wer hat wann was am Ticket geändert (Create/Update/Delete + KI-Aktionen).
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });
    const result = await auditService.findRecent({
      targetType: 'ticket',
      targetId:   req.params.id,
      limit:      Number(req.query.limit) || 100,
    });
    // findRecent gibt { data, total, limit, offset } zurück — history-Route nutzt nur data.
    res.json({ data: result.data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── FP-Exception-Routen — ausgelagert in eigenen Router (SRP) ──
// Pfade bleiben identisch: /api/v1/tickets/:id/fp-exception/...
router.use('/:id/fp-exception', fpExceptionRoutes);

// ── GET /api/v1/tickets/:id/timeline — Flow-/Event-Timeline aus dem Indexer ──
router.get('/:id/timeline', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });
    if (ticket.source !== 'wazuh' || !wazuhIndexerClient.isEnabled()) {
      return res.json({ enabled: false, data: null, requestId: req.id });
    }
    // Offense-Ziel ableiten: Einzel-Alert (rule+agent) ODER Host-Case (host:<agentId>).
    const m  = /wazuh:rule:([^:]+):agent:(.+)/.exec(ticket.offenseId || '');
    const hm = /wazuh:host:(.+)/.exec(ticket.offenseId || '');
    const isHostCase = !m && !!hm; // Host-Case: gezielt nur flow-relevante Events holen (size-Fenster-Fix)
    const data = await wazuhIndexerClient.ticketFlows({
      ruleId:  m ? m[1] : null,
      agentId: m ? m[2] : (hm ? hm[1] : null),
      srcIp:   ticket.srcIp || null,
      flowOnly: isHostCase,
    });
    // CE-3: rohe _source-Events durch den Flow-Normalizer → einheitliche network-Sektion.
    // CE-4.3: Inventory-Lookup (Host/MAC/Host-Interface) soft laden — bei Fehler null,
    // dann bleibt die Sektion unverändert (missingReason inventory_not_loaded).
    const { sources = [], ...timeline } = data || {};
    const inventoryLookup = await inventoryLookupCache.getLookup().catch(() => null);
    const network = buildNetworkCorrelation(sources, { inventoryLookup });
    // CE-5.3: optionale DNS-forward-confirm-FQDN-Anreicherung (ENV-gated, default aus).
    // Soft-fail: bricht die Sektion nie; gaps werden nach der Anreicherung neu berechnet.
    if (FQDN_ENABLED) {
      try {
        network.flows = await enrichFlowsWithDnsFqdn(network.flows, { resolveFqdn: fqdnResolver, domain: FQDN_DOMAIN, enabled: FQDN_ENABLED });
        network.gaps = collectGaps(network.flows);
      } catch (e) {
        logger.warn({ message: 'fqdn_enrichment_failed', error: e.message, requestId: req.id });
      }
    }

    // Slice 2b.2: Honeypot-Sessions als SEPARATER Block (nie in network.flows).
    // Gate + belegter Agent (aus Cowrie-Events, NICHT offenseId) + Zeitfenster stecken
    // im reinen Orchestrator; die Route bleibt dünn und soft-fail.
    try {
      const hp = await buildHoneypotSessions({
        sources,
        fetchSessions: (q) => wazuhIndexerClient.ticketHoneypotSessions(q),
      });
      network.honeypotSessions = hp.honeypotSessions;
    } catch (e) {
      network.honeypotSessions = [];
      logger.warn({ message: 'honeypot_sessions_failed', error: e.message, requestId: req.id });
    }

    // Slice 3b: Correlated Exposure Stitching (ADR-034) — korrelierte Ableitung aus
    // Honeypot-Session + Firewall-5-Tuple, KEINE NAT-Behauptung. Eigener Block, soft-fail.
    try {
      network.exposureCorrelations = await buildExposureCorrelations({
        honeypotSessions: network.honeypotSessions,
        fetchFirewallFlows: (q) => wazuhIndexerClient.ticketFirewallFlows(q),
      });
    } catch (e) {
      network.exposureCorrelations = [];
      logger.warn({ message: 'exposure_correlation_failed', error: e.message, requestId: req.id });
    }

    // Auto-Threat-Intel: öffentliche Ticket-IPs (Honeypot → Angreifer-Source-IP) automatisch
    // anreichern, damit Geo/ASN/Reputation/Verdict OHNE „Enrich"-Klick im Deck stehen. Cache
    // macht wiederholte Loads billig. Soft-fail: bricht den Deck-Load nie.
    try {
      network.threatIntel = await buildTicketThreatIntel({
        ips: ticketIps(ticket),
        enrich: (q) => threatIntelService.enrich(q),
        isPublic: isPublicIp,
      });
    } catch (e) {
      network.threatIntel = [];
      logger.warn({ message: 'ticket_threat_intel_failed', error: e.message, requestId: req.id });
    }

    res.json({ enabled: true, data: timeline, network, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/:id/import — Smart-Parser-Preview (kein Persistieren) ──
// Parst einen Roh-String (IP, Hash, URL, Base64 …) und liefert strukturierte ParsedEvidence.
// Analyst entscheidet anschliessend im Modal, ob er als Evidence speichert.
router.post('/:id/import', requireAuth, requireRole('analyst', 'admin'), validate(importRawSchema), async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });

    const { raw, sourceType } = req.body;
    const parseResult = smartParse(raw, sourceType);
    const evidence    = parsedToEvidence(parseResult, sourceType);

    res.json({
      data: {
        type    : parseResult.type,
        evidence,
        iocs    : evidence.iocs || [],
      },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/cross-ref — IoC-Querverweise über Tickets ──
// Body { values: string[], excludeId } → { value: [matchingTickets] }. Read-only.
router.post('/cross-ref', requireAuth, async (req, res, next) => {
  try {
    const values = Array.isArray(req.body?.values) ? req.body.values.slice(0, 20) : [];
    const excludeId = req.body?.excludeId || null;
    const out = {};
    for (const v of values) out[v] = await ticketService.findByIndicator(v, excludeId);
    res.json({ data: out, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/bulk-delete — admin only ──────────
// Echte Sammel-Löschung (P_STABILITY_1 · Task 2): EIN Request statt N Einzel-Deletes,
// EIN atomares DELETE im Repo, EIN Sammel-Audit-Eintrag. Bounded via Schema (max 100).
// Ergebnis (requested/deleted/missing) geht ehrlich zurück — kein Fake-Erfolg, das
// Frontend lädt erst nach dieser Antwort neu.
router.post('/bulk-delete', requireAuth, requireRole('admin'), validate(bulkDeleteTicketsSchema), async (req, res, next) => {
  try {
    const result = await ticketService.deleteMany(req.body.ids);
    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      AUDIT_ACTIONS.TICKET_BULK_DELETE,
      targetType:  'ticket',
      // Sammel-Operation → kein einzelnes targetId; Anzahl + gelöschte IDs (interne UUIDs,
      // kein PII, gedeckelt auf max 100) in metadata für die forensische Nachvollziehbarkeit.
      metadata:    { requested: result.requested, deleted: result.deleted, missing: result.missing, ids: result.deletedIds },
      ip:          req.ip,
    });
    res.json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/:id/threat-intel/enrich — Reputation der Ticket-IPs (Batch) ──
// Reichert die IP-Indikatoren des Tickets über den Threat-Intel-Service an (Cache, max 20).
// Threat Intel ist Kontext — KEINE automatische Ticket-Entscheidung.
router.post('/:id/threat-intel/enrich', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });
    const results = [];
    for (const ip of ticketIps(ticket).slice(0, 20)) {
      const r = await threatIntelService.enrich({ indicatorType: 'ip', indicatorValue: ip });
      if (r.ok) {
        results.push({ indicatorValue: ip, indicatorType: 'ip', verdict: r.result.verdict, score: r.result.score, confidence: r.result.confidence, source: r.result.source, summary: r.result.summary });
      }
    }
    res.json({ data: results, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets — analyst + admin ─────────────────
router.post('/', requireAuth, requireRole('analyst','admin'), validate(createTicketSchema), async (req, res, next) => {
  try {
    const ticket = await ticketService.create(req.body);
    // P16: Bei Wazuh-Tickets Endpoint-Artefakte sammeln (fire-and-forget, Route-Side-Effect).
    if (ticket.source === 'wazuh') {
      const m = String(ticket.offenseId || '').match(/:agent:([^:\s]+)/);
      const agentId = m ? m[1] : (req.body?.metadata?.agentId || req.body?.agentId || '');
      if (agentId) {
        Promise.resolve()
          .then(() => collectEndpointEvidence(agentId, ticket.id, evidenceService))
          .catch((err) => logger.error('Evidence-Collector fehlgeschlagen', { ticketId: ticket.id, agentId, error: err.message }));
      }
    }
    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      AUDIT_ACTIONS.TICKET_CREATE,
      targetType:  'ticket',
      targetId:    ticket.id,
      ip:          req.ip,
    });

    // Notification-Trigger: kritische/hohe Tickets an Analysten/Engineer/Admin (best-effort).
    // Darf das Ticket-Anlegen NIE brechen — identisches Fire-and-Forget-Muster wie P16.
    if (ticket.priority === 'critical' || ticket.priority === 'high') {
      Promise.resolve()
        .then(() => notificationService.broadcastToRoles(
          ['analyst', 'engineer', 'admin'],
          {
            severity: ticket.priority,
            title:    `Vorfall: ${ticket.title}`,
            body:     `Priorität: ${ticket.priority} — Ticket ${ticket.ticketNr || ticket.id}`,
            source:   'ticket',
            link:     `/analysis?ticket=${ticket.id}`,
          }
        ))
        .catch((err) => logger.error('Notification-Broadcast fehlgeschlagen', {
          ticketId: ticket.id,
          error:    err.message,
        }));
    }

    res.status(201).json({ data: ticket, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/tickets/:id — analyst + admin ──────────────
router.put('/:id', requireAuth, requireRole('analyst','admin'), validate(updateTicketSchema), async (req, res, next) => {
  try {
    const { ticket } = await correlationMutationService.updateTicket(
      req.params.id,
      req.body,
      req.rawBodyKeys || Object.keys(req.body || {})
    );
    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      AUDIT_ACTIONS.TICKET_UPDATE,
      targetType:  'ticket',
      targetId:    ticket.id,
      ip:          req.ip,
      metadata:    { fields: req.rawBodyKeys || Object.keys(req.body || {}) },   // nur gesendete Feldnamen, keine Werte (PII)
    });
    res.json({ data: ticket, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/tickets/:id — admin only ────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await ticketService.delete(req.params.id);
    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      AUDIT_ACTIONS.TICKET_DELETE,
      targetType:  'ticket',
      targetId:    req.params.id,
      ip:          req.ip,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/:id/collect-evidence — P16 manueller Evidence-Trigger ──
// Analyst sammelt Endpoint-Artefakte (Prozesse/Ports/Netzwerk) für ein Ticket manuell.
// agentId aus offenseId (:agent:<id>) oder Body. Fail-safe bei Wazuh-Ausfall.
router.post('/:id/collect-evidence', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ ok: false, reason: 'ticket_not_found', requestId: req.id });

    const mAgent = /:agent:([^:\s]+)/.exec(ticket.offenseId || '');
    const agentId = (mAgent ? mAgent[1] : '') || String(req.body?.agentId || '').trim();
    if (!agentId) return res.status(422).json({ ok: false, reason: 'no_agent_id', requestId: req.id });

    if (typeof wazuhApiClient.isEnabled === 'function' && !wazuhApiClient.isEnabled()) {
      return res.status(200).json({ ok: false, reason: 'wazuh_disabled', collected: 0, requestId: req.id });
    }

    let collected;
    try {
      collected = await collectEndpointEvidence(agentId, ticket.id, evidenceService);
    } catch (collErr) {
      logger.error('collect-evidence: Wazuh-Aufruf fehlgeschlagen', { ticketId: ticket.id, error: collErr.message });
      return res.status(503).json({ ok: false, reason: 'wazuh_unavailable', requestId: req.id });
    }

    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      'EVIDENCE_COLLECT',
      targetType:  'ticket',
      targetId:    ticket.id,
      ip:          req.ip,
      metadata:    { collected },
    });

    res.json({ ok: true, collected, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/:id/export — Ticket an externes System exportieren ──
// Outbound-Export (P12): ServiceNow / OTRS. Default inert (EXTERNAL_TICKET_EXPORT_ENABLED).
// analyst + admin. Body { system }. ExternalTicketService sendet + auditiert (Erfolg/Fehler);
// unbekanntes/registriertes-aber-unkonfiguriertes System → klarer Fehler über die Fehler-Middleware.
router.post('/:id/export', requireAuth, requireRole('analyst', 'admin'), validate(exportTicketSchema), async (req, res, next) => {
  try {
    if (!config.externalTicket.enabled) {
      return res.status(503).json({ error: 'external_ticket_export_disabled', requestId: req.id });
    }
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });

    const { system } = req.body;
    const result = await externalTicketService.exportTicket(ticket, system, {
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      ip:          req.ip,
    });

    res.status(201).json({
      data: {
        status:      result.status,
        system,
        externalId:  result.externalId,
        externalUrl: result.link?.externalUrl || '',
      },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tickets/:id/export/sync-status — Status ins externe System spiegeln ──
// Setzt voraus, dass das Ticket vorher exportiert wurde (gespeicherter ExternalLink).
// analyst + admin, Gate EXTERNAL_TICKET_EXPORT_ENABLED. Body { system }.
router.post('/:id/export/sync-status', requireAuth, requireRole('analyst', 'admin'), validate(exportTicketSchema), async (req, res, next) => {
  try {
    if (!config.externalTicket.enabled) {
      return res.status(503).json({ error: 'external_ticket_export_disabled', requestId: req.id });
    }
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });

    const { system } = req.body;
    const result = await externalTicketService.syncStatus(ticket, system, {
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      ip:          req.ip,
    });

    res.json({
      data: { status: result.status, system, externalId: result.externalId, externalStatus: result.externalStatus },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
