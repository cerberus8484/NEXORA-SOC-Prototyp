'use strict';

// Hosts — Inventory-Detail + Alert-History pro Wazuh-Agent.
// Detail/Inventory: Read-Proxy auf die Wazuh-API (best-effort, weich).
// Alert-History: Tickets dieses Hosts (agentId via offenseId :agent:<id> oder hostname).
// RBAC: requireAuth (viewer+). Kein Write.

const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate                     = require('../middleware/validate');
const { wazuhApiClient }           = require('../integrations/adapters/wazuh/wazuhApiInstance');
const { ticketService }            = require('../services/TicketService');
const { evidenceService }          = require('../services/EvidenceService');
const { collectEndpointEvidence }  = require('../integrations/adapters/wazuh/wazuhEvidenceCollector');
const { addHostSchema }            = require('../domain/validation/hostSchema');
const { manualHostSchema }         = require('../domain/validation/manualHostSchema');
const { manualHostService }        = require('../services/ManualHostService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');

const router = Router();

// POST /api/v1/hosts — Host-Enrollment: neuen Wazuh-Agent registrieren (admin).
// Create am Wazuh-Manager; liefert den einmaligen Enrollment-Key. Kein Modify/Delete.
router.post('/', requireAuth, requireRole('admin'), validate(addHostSchema), async (req, res, next) => {
  try {
    const agent = await wazuhApiClient.addAgent({ name: req.body.name, ip: req.body.ip });
    // Auditieren (wie jede state-changing Admin-Aktion) — NIE den Enrollment-Key.
    await auditService.write({
      actorUserId: req.user.sub, actorLabel: req.user.email, action: AUDIT_ACTIONS.WAZUH_AGENT_ENROLLED,
      targetType: 'wazuh_agent', targetId: agent.id, metadata: { agentName: agent.name }, ip: req.ip,
    });
    res.status(201).json({ data: { id: agent.id, name: agent.name, key: agent.key }, requestId: req.id });
  } catch (err) { next(err); }
});

// Syscollector-Inventory auf die fürs Frontend relevanten Kennzahlen verdichten.
function summariseInventory(inv) {
  if (!inv) return null;
  const ramKb = inv.hardware?.ram?.total;
  return {
    installedPackages: inv.packagesTotal ?? null,
    openPorts:         inv.portsTotal ?? null,
    processes:         inv.processesTotal ?? null,
    cpu:               inv.hardware?.cpu?.name ?? null,
    cpuCores:          inv.hardware?.cpu?.cores ?? null,
    cpuMhz:            inv.hardware?.cpu?.mhz ?? null,
    ramGb:             ramKb ? Number((ramKb / 1024 / 1024).toFixed(1)) : null,
    ramUsagePct:       inv.hardware?.ram?.usage ?? null,
    architecture:      inv.os?.architecture ?? null,
    hostname:          inv.os?.hostname ?? null,
  };
}

// Software-Listen-Query verdichten + cappen (Defense-in-Depth, Client cappt auch).
const PACKAGES_LIMIT_MAX     = 200;
const PACKAGES_LIMIT_DEFAULT = 50;

function parsePackagesQuery(query) {
  const rawLimit = Number(query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), PACKAGES_LIMIT_MAX)
    : PACKAGES_LIMIT_DEFAULT;
  const rawOffset = Number(query.offset);
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  return { limit, offset, search };
}

// Wazuh-Agent-Objekt → schlanke Host-Detail-Form.
function summariseAgent(agent) {
  return {
    agentId:       agent.id,
    hostname:      agent.name,
    ip:            agent.ip || null,
    status:        agent.status || 'unknown',
    os:            agent.os ? `${agent.os.name ?? ''} ${agent.os.version ?? ''}`.trim() || null : null,
    agentVersion:  agent.version || null,
    lastHeartbeat: agent.lastKeepAlive || null,
    group:         Array.isArray(agent.group) ? agent.group : [],
  };
}

// ── Manual-Host-Quelle (Nicht-Wazuh-Assets) ─────────────────────────────────
// Assets ohne Wazuh-Agent, die im Host-Inventar erscheinen sollen (source='manual').
// WICHTIG: vor '/:agentId' registriert — sonst matcht '/manual' als agentId.

// GET /api/v1/hosts/manual — alle manuell gepflegten Hosts (viewer+).
router.get('/manual', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await manualHostService.list(), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/hosts/manual — neues Asset anlegen (admin, validiert, auditiert).
router.post('/manual', requireAuth, requireRole('admin'), validate(manualHostSchema), async (req, res, next) => {
  try {
    const host = await manualHostService.add(req.body, { userId: req.user.sub, label: req.user.email, ip: req.ip });
    res.status(201).json({ data: host, requestId: req.id });
  } catch (err) { next(err); }
});

// DELETE /api/v1/hosts/manual/:id — Asset entfernen (admin, auditiert).
router.delete('/manual/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const removed = await manualHostService.remove(req.params.id, { userId: req.user.sub, label: req.user.email, ip: req.ip });
    if (!removed) return res.status(404).json({ error: 'not_found', requestId: req.id });
    res.json({ ok: true, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/hosts/:agentId — Inventory-Detail (Agent-Stammdaten + Syscollector).
router.get('/:agentId', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: null, requestId: req.id });
    }
    const agent = await wazuhApiClient.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'not_found', requestId: req.id });
    const inventory = await wazuhApiClient.getAgentInventory(req.params.agentId).catch(() => null);
    res.json({
      enabled: true,
      data: { ...summariseAgent(agent), inventory: summariseInventory(inventory) },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/hosts/:agentId/alerts — letzte Tickets/Alerts dieses Hosts (default 20).
router.get('/:agentId/alerts', requireAuth, async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const data = await ticketService.findByHost({
      agentId:  req.params.agentId,
      hostname: typeof req.query.hostname === 'string' ? req.query.hostname : '',
      limit,
    });
    res.json({ data, total: data.length, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/hosts/:agentId/packages — installierte Software-Liste (paginiert, filterbar).
// RBAC: requireAuth (viewer+). Read-Proxy auf Wazuh-Syscollector.
router.get('/:agentId/packages', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: [], total: 0, requestId: req.id });
    }
    const { limit, offset, search } = parsePackagesQuery(req.query);
    const { items, total } = await wazuhApiClient.getAgentPackages(req.params.agentId, { limit, offset, search });
    res.json({ enabled: true, data: items, total, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/hosts/:agentId/collect — Evidence Collector manuell auslösen.
// Sammelt Endpoint-Artefakte und hängt sie an das angegebene Ticket.
// RBAC: analyst+ (Write). Body: { ticketId }.
router.post('/:agentId/collect', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId.trim() : '';
    if (!ticketId) {
      return res.status(400).json({ error: 'ticketId fehlt', requestId: req.id });
    }
    const count = await collectEndpointEvidence(req.params.agentId, ticketId, evidenceService);
    res.json({ ok: true, count, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
