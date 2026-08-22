'use strict';

const { auditService }  = require('../../../services/AuditService');
const { ticketService } = require('../../../services/TicketService');
const logger            = require('../../../logger');

// CrowdsecProcessor — macht aus einem normalisierten CrowdSec-Alert ein Ticket.
//
// Dedup/Korrelation (1 Ticket pro Offense, restart-sicher gegen die Tickets-Tabelle):
//   offenseId = crowdsec:alert:<id>  (siehe crowdsecMapper)
//   → offenes Ticket dieser Offense innerhalb des Fensters → UPDATE (Recurrence)
//   → keins offen / zu alt                                 → CREATE
//
// Bewusst simpler als WazuhProcessor: WAN-Alerts haben keinen Host-Agent → kein
// Host-Case-Bundling, kein API-Enrichment. Wird vom IntegrationProcessor (Worker)
// mit normalizedData aufgerufen.

const MAX_LOG = 20000;
const DEFAULT_WINDOW_H = 24;

// IOCs aus dem normalisierten Alert (Quell-/Ziel-IP), dedupliziert.
function buildIocs(n) {
  return [...new Set([n.srcIp, n.dstIp].filter(Boolean))].join('\n');
}

function mergeIocs(existing, incoming) {
  const set = new Set(
    [...(existing || '').split('\n'), ...(incoming || '').split('\n')]
      .map((s) => s.trim()).filter(Boolean),
  );
  return [...set].join('\n');
}

// Roh-Event + Kontext ins Log-/Evidence-Feld — voller Alert bleibt am Ticket.
function buildLogs(n) {
  const parts = ['CrowdSec-Alert (Webserver / WAN)'];
  if (n.scenario)    parts.push(`Szenario: ${n.scenario}`);
  if (n.eventsCount != null) parts.push(`Events: ${n.eventsCount}`);
  const asPart = [n.asNumber && `AS${n.asNumber}`, n.asName, n.country].filter(Boolean).join(' ');
  if (asPart)        parts.push(`Quelle: ${asPart}`);
  parts.push(n.banned ? `Decision: ban ${n.banDuration || ''}`.trim() : 'Decision: keine aktive Sperre');
  let json = '';
  try { json = JSON.stringify(n.raw, null, 2); } catch { json = String(n.raw); }
  parts.push(`\nRaw Alert (JSON):\n${json}`);
  return parts.join('\n').slice(0, MAX_LOG);
}

class CrowdsecProcessor {
  constructor(tickets = ticketService, opts = {}) {
    this._tickets  = tickets;
    this._windowMs = (opts.windowH ?? DEFAULT_WINDOW_H) * 3600_000;
  }

  async process(normalizedData) {
    const offenseId = normalizedData.externalId;
    const existing  = offenseId ? await this._tickets.findOpenByOffense('crowdsec', offenseId) : null;
    const fresh     = existing && (Date.now() - new Date(existing.updatedAt).getTime()) < this._windowMs;
    return fresh ? this._update(existing, normalizedData) : this._create(normalizedData);
  }

  async _create(n) {
    const draft = {
      title:       n.title,
      category:    n.category,
      priority:    n.priority,
      state:       'OPEN',
      status:      'assigned',
      source:      'crowdsec',
      kind:        'alert',
      datetime:    n.datetime,
      srcIp:       n.srcIp,
      dstIp:       n.dstIp,
      description: n.description,
      offenseId:   n.externalId,
      iocs:        buildIocs(n),
      mitre:       n.mitre ? `${n.mitre.id} ${n.mitre.name}` : '',
      logs:        buildLogs(n),
    };

    const ticket = await this._tickets.create(draft);

    await auditService.write({
      action:     'CROWDSEC_TICKET_CREATED',
      targetType: 'ticket',
      targetId:   ticket.id,
      metadata:   { offenseId: n.externalId, title: ticket.title, priority: ticket.priority },
    });

    logger.info('crowdsec_ticket_created', { ticketId: ticket.id, offenseId: n.externalId });
    return { action: 'created', ticketId: ticket.id };
  }

  async _update(existing, n) {
    // Recurrence derselben Offense — Counter hoch, IOCs aufsammeln, Prio/Beschreibung
    // auffrischen. Datenminimierung: kein audit_log pro Recurrence, nur Log.
    const alertCount = (existing.alertCount || 1) + 1;
    await this._tickets.update(existing.id, {
      priority:    n.priority,
      description: n.description,
      alertCount,
      iocs:        mergeIocs(existing.iocs, buildIocs(n)),
    });

    logger.info('crowdsec_ticket_updated', { ticketId: existing.id, offenseId: n.externalId, alertCount });
    return { action: 'updated', ticketId: existing.id, alertCount };
  }
}

module.exports = { CrowdsecProcessor };
