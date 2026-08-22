'use strict';

const { auditService }  = require('../../../services/AuditService');
const { ticketService } = require('../../../services/TicketService');
const config            = require('../../../config');
const logger            = require('../../../logger');

const MAX_FIELD = 5000;  // IOCs etc. (Joi STR-Limit)
const MAX_LOG   = 20000; // logs: vollständiges Roh-Event behalten (Windows-Events groß) — Joi STR20K

// IOCs aus den Alert-Daten sammeln (IPs, User, Windows-Eventdata) — dedupliziert.
function buildIocs(n) {
  const raw = n.raw || {};
  const d   = raw.data || {};
  const win = (d.win && d.win.eventdata) || {};
  const set = new Set();
  [
    n.srcIp, n.dstIp, d.srcip, d.dstip, d.srcuser, d.dstuser,
    raw.agent && raw.agent.ip,
    win.ipAddress, win.targetUserName, win.image, win.commandLine,
  ].forEach((v) => { if (v) set.add(String(v)); });
  return [...set].join('\n').slice(0, MAX_FIELD);
}

// Zwei IOC-Listen (Zeilen) vereinen, dedupliziert, begrenzt.
function mergeIocs(existing, incoming) {
  const set = new Set(
    [...(existing || '').split('\n'), ...(incoming || '').split('\n')]
      .map((s) => s.trim()).filter(Boolean),
  );
  return [...set].join('\n').slice(0, MAX_FIELD);
}

// ── MAC-Auflösung aus Syscollector-Interfaces (rein, gut testbar) ───────────
const NULL_MAC = '00:00:00:00:00:00';

// Gültige Hardware-MAC? (sechs Hex-Oktette, nicht die Null-MAC).
function isRealMac(mac) {
  const v = typeof mac === 'string' ? mac.trim() : '';
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(v) && v.toLowerCase() !== NULL_MAC;
}

// IPv4-Werte eines Interfaces normalisieren (String/Array/Objekt, CIDR abschneiden).
function ifaceIps(iface) {
  const v4  = iface && iface.ipv4;
  const raw = Array.isArray(v4) ? v4 : (v4 ? [v4] : []);
  return raw
    .map((e) => (e && typeof e === 'object' ? e.address : e))
    .filter(Boolean)
    .map((s) => String(s).split('/')[0].trim());
}

// Primäre MAC wählen: Interface mit passender Agent-IP gewinnt, sonst erstes mit echter MAC.
function pickInterfaceMac(interfaces, agentIp) {
  const withMac = (Array.isArray(interfaces) ? interfaces : []).filter((i) => isRealMac(i && i.mac));
  if (withMac.length === 0) return undefined;
  const byIp = agentIp ? withMac.find((i) => ifaceIps(i).includes(String(agentIp))) : undefined;
  return (byIp || withMac[0]).mac.trim();
}

// Roh-Event in das Log-/Evidence-Feld — damit der volle Alert am Ticket bleibt.
function buildLogs(n) {
  const raw   = n.raw || {};
  const parts = [];
  if (raw.location)  parts.push(`Location: ${raw.location}`);
  if (raw.agent)     parts.push(`Agent: ${raw.agent.name || '?'} (id ${raw.agent.id || '?'}, ${raw.agent.ip || 'IP?'})`);
  if (raw.rule)      parts.push(`Rule ${raw.rule.id} — Level ${raw.rule.level} — ${raw.rule.description || ''}`);
  if (raw.full_log)  parts.push(`\nFull Log:\n${raw.full_log}`);
  let json = '';
  try { json = JSON.stringify(raw, null, 2); } catch { json = String(raw); }
  parts.push(`\nRaw Alert (JSON):\n${json}`);
  return parts.join('\n').slice(0, MAX_LOG);
}

// Strukturierte Prozess-/Command-/Netzwerk-Evidence aus win.eventdata in dedizierte
// Ticket-Felder ziehen — sonst landet der Roh-Event nur als Freitext in logs/iocs und
// erreicht den Analysis-Deck nie. Deckt Sysmon Event 1/3 (commandLine) UND PowerShell
// ScriptBlock-Logging (Event 4104, scriptBlockText, z. B. Rule 91809) ab. Werte werden
// auf die Joi-Schema-Limits gekappt; fehlt etwas, bleibt das Feld weg (keine Fake-Daten).
function buildEventFields(n) {
  const raw = n && n.raw ? n.raw : {};
  const d   = raw.data || {};
  const win = (d.win && d.win.eventdata) || {};
  const str = (v) => (v != null && String(v).trim() ? String(v).trim() : undefined);
  const out = {};

  const image = str(win.image);
  if (image) out.process = image.slice(0, 200);                       // STR200
  // Command-Line: Sysmon E1/Security 4688 ODER PowerShell ScriptBlock (Event 4104).
  const cmd = str(win.commandLine) || str(win.processCommandLine) || str(win.scriptBlockText);
  if (cmd) out.commandLine = cmd.slice(0, 20000);                     // STR20K (Skripte groß)
  const user = str(win.targetUserName) || str(win.user) || str(d.srcuser);
  if (user) out.user = user.slice(0, 100);                            // STR100
  const protocol = str(win.protocol);
  if (protocol) out.protocol = protocol.slice(0, 100);                // STR100
  const port = str(win.destinationPort) || str(win.sourcePort);
  if (port) out.port = port.slice(0, 100);                            // STR100
  const hash = str(win.hashes) || str(win.hash);
  if (hash) out.hash = hash.slice(0, 256);                            // max 256

  return out;
}

/**
 * WazuhProcessor — macht aus einem normalisierten Wazuh-Alert ein Ticket.
 *
 * Dedup/Korrelation (1 Ticket pro Offense):
 *   offenseId = wazuh:rule:<ruleId>:agent:<agentId>   (siehe wazuhMapper)
 *   → offenes Ticket mit dieser offenseId vorhanden  → UPDATE (Recurrence)
 *   → keins offen                                     → CREATE
 *
 * Dedup läuft gegen die Tickets-Tabelle (restart-sicher), nicht im Speicher.
 * Wird vom IntegrationProcessor (Worker) mit normalizedData aufgerufen.
 */
class WazuhProcessor {
  constructor(tickets = ticketService, opts = {}) {
    this._tickets  = tickets;
    this._minLevel = opts.minLevel ?? config.wazuh.minLevel;
    this._windowMs = (opts.windowH ?? config.wazuh.correlationWindowH) * 3600_000;
    this._api      = opts.apiClient || null; // optionaler WazuhApiClient für Enrichment
  }

  async process(normalizedData) {
    // 1. Rausch-Filter: niedrige Rule-Level werden kein Ticket
    const level = Number(normalizedData.raw?.rule?.level || 0);
    if (level < this._minLevel) {
      logger.info('wazuh_alert_skipped_low_level', { level, minLevel: this._minLevel, offenseId: normalizedData.externalId });
      return { action: 'skipped', level };
    }

    // 2. Parent-Case pro Host sicherstellen (bündelt alle Offenses des Agents)
    const parent = await this._findOrCreateCase(normalizedData);

    // 3. Korrelation: offenes Ticket derselben Offense nur INNERHALB des Fensters
    //    aktualisieren — ältere/abgeschlossene Offense → neuer Case (Recurrence).
    const offenseId = normalizedData.externalId;
    const existing  = offenseId ? await this._tickets.findOpenByOffense('wazuh', offenseId) : null;
    const fresh     = existing && (Date.now() - new Date(existing.updatedAt).getTime()) < this._windowMs;

    return fresh
      ? this._update(existing, normalizedData)
      : this._create(normalizedData, parent?.id || '');
  }

  // Host-Case (Parent) finden/anlegen. Bündelt alle Offenses eines Agents.
  // Beim Neuanlegen werden bereits vorhandene Childs des Hosts adoptiert.
  async _findOrCreateCase(normalizedData) {
    const raw     = normalizedData.raw || {};
    const agentId = raw.agent?.id;
    if (!agentId) return null;

    const caseOffenseId = `wazuh:host:${agentId}`;
    const existing = await this._tickets.findOpenByOffense('wazuh', caseOffenseId);
    if (existing) {
      // Gesamt-Alertzähler des Hosts hochziehen.
      const patch = { alertCount: (existing.alertCount || 1) + 1 };
      // Self-Healing: Altbestand ohne MAC einmalig nachreichern (danach kein API-Call je Alert).
      if (!existing.mac) {
        const mac = await this._resolveAgentMac(agentId, existing.sensorIp || existing.srcIp);
        if (mac) patch.mac = mac;
      }
      await this._tickets.update(existing.id, patch);
      return existing;
    }

    const hostName = raw.agent?.name || agentId;
    const draft = {
      title:       `Host-Case: ${hostName}`,
      category:    'host-case',
      priority:    normalizedData.priority,
      state:       'OPEN',
      status:      'assigned',
      source:      'wazuh',
      kind:        'case',
      offenseId:   caseOffenseId,
      alertCount:  1,
      // Host-Case hat keine einzelne Angreifer-Quelle: agent.ip ist der Sensor,
      // NICHT srcIp (Maskerade entfernt, Slice 2b.0).
      sensorIp:    raw.agent?.ip || '',
      description: `Aggregierter Host-Case für ${hostName} (Agent ${agentId}). Bündelt alle Wazuh-Offenses dieses Hosts.`,
    };
    await this._enrichFromApi(draft, normalizedData);
    const created = await this._tickets.create(draft);

    // Bereits vorhandene, elternlose Offenses dieses Hosts unter den Case hängen
    if (this._tickets.assignParentByAgent) {
      const adopted = await this._tickets.assignParentByAgent(agentId, created.id);
      if (adopted) logger.info('wazuh_case_adopted_children', { caseId: created.id, agentId, adopted });
    }

    logger.info('wazuh_host_case_created', { caseId: created.id, agentId, host: hostName });
    return created;
  }

  async _create(normalizedData, parentId = '') {
    const draft = {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      state:       'OPEN',
      status:      'assigned',
      source:      'wazuh',
      kind:        'alert',
      parentId,
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      dstIp:       normalizedData.dstIp,
      sensorIp:    normalizedData.sensorIp,
      attackerIp:  normalizedData.attackerIp,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
      // Reiche Daten aus dem Alert mitnehmen — sonst geht das Roh-Event verloren.
      iocs:  buildIocs(normalizedData),
      mitre: (normalizedData.mitre?.techniqueIds || []).join(', '),
      logs:  buildLogs(normalizedData),
      // Strukturierte Prozess-/Command-/Netzwerk-Felder → erreichen den Analysis-Deck.
      ...buildEventFields(normalizedData),
    };

    await this._enrichFromApi(draft, normalizedData);

    const ticket = await this._tickets.create(draft);

    await auditService.write({
      action:     'WAZUH_TICKET_CREATED',
      targetType: 'ticket',
      targetId:   ticket.id,
      metadata:   { offenseId: normalizedData.externalId, title: ticket.title, priority: ticket.priority },
    });

    logger.info('wazuh_ticket_created', { ticketId: ticket.id, offenseId: normalizedData.externalId });
    return { action: 'created', ticketId: ticket.id };
  }

  // Best-effort: Agent-Details aus der Wazuh-API ziehen und ins Ticket schreiben.
  // Ein API-Fehler darf die Ticket-Erstellung NIE verhindern.
  async _enrichFromApi(draft, normalizedData) {
    if (!this._api || !this._api.isEnabled?.()) return;
    const agentId = normalizedData.raw?.agent?.id;
    if (!agentId) return;
    try {
      const agent = await this._api.getAgent(agentId);
      if (!agent) return;
      const os = [agent.os?.name, agent.os?.version].filter(Boolean).join(' ');
      if (os)          draft.os       = os;
      if (agent.name)  draft.hostname = agent.name;
      if (agent.id)    draft.assetTag = `wazuh-agent-${agent.id}`;
      // MAC aus dem Syscollector-Interface (optionaler API-Teil, eigener Best-effort-Pfad).
      const mac = await this._resolveAgentMac(agentId, agent.ip);
      if (mac)         draft.mac      = mac;
      const ctx = `Agent (Wazuh-API): ${agent.name || '?'} | OS ${os || '?'} | IP ${agent.ip || '?'} | Status ${agent.status || '?'} | Gruppe ${(agent.group || []).join(',') || '-'}`;
      draft.logs = `${ctx}\n\n${draft.logs || ''}`.slice(0, MAX_LOG);
    } catch (err) {
      logger.warn('wazuh_api_enrich_failed', { agentId, error: err.message });
    }
  }

  // MAC eines Agents über Syscollector-Interfaces auflösen — best-effort, wirft nie.
  // Bei alten API-Clients ohne getNetInterfaces bleibt die MAC leer (keine Fake-Daten).
  async _resolveAgentMac(agentId, agentIp) {
    if (!this._api || !this._api.isEnabled?.() || !agentId) return undefined;
    if (typeof this._api.getNetInterfaces !== 'function') return undefined;
    try {
      return pickInterfaceMac(await this._api.getNetInterfaces(agentId), agentIp);
    } catch (err) {
      logger.warn('wazuh_api_mac_resolve_failed', { agentId, error: err.message });
      return undefined;
    }
  }

  async _update(existing, normalizedData) {
    // Recurrence derselben Offense — Counter hochzählen, IOCs aufsammeln,
    // Priorität/Beschreibung auffrischen. Ticket bleibt offen.
    const alertCount = (existing.alertCount || 1) + 1;
    await this._tickets.update(existing.id, {
      priority:    normalizedData.priority,
      description: normalizedData.description,
      alertCount,
      iocs:        mergeIocs(existing.iocs, buildIocs(normalizedData)),
    });

    // Datenminimierung (Art. 5(1)(c)): KEIN audit_log-Eintrag pro Alert-Recurrence
    // mehr — das ist Betriebs-Telemetrie (liegt im Wazuh-Indexer), kein
    // Accountability-Ereignis. Nur strukturiertes Log (stdout), nicht in die DB.
    logger.info('wazuh_ticket_updated', { ticketId: existing.id, offenseId: normalizedData.externalId, alertCount });
    return { action: 'updated', ticketId: existing.id, alertCount };
  }
}

module.exports = { WazuhProcessor, buildEventFields };
