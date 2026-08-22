'use strict';

// DataplaneIncidentAdapter — die Naht Data Plane → Nexora (ADR-035 §8).
// Nimmt einen fusionierten Cross-Domain-Vorfall (FusedIncident vom Outbox-Worker)
// und überführt ihn — Adapter-Pflicht: validate → normalize → toTicketDraft —
// in ein internes Nexora-Ticket. Externer Input wird NIE direkt zum Ticket.
const { BaseAdapter } = require('../../BaseAdapter');
const { fusedIncidentSchema } = require('./dataplaneSchemas');
const { ValidationError } = require('../../../errors/AppError');

const MAX_DESC = 5000;
const MAX_FIELD = 5000;
const MAX_PAYLOADS = 50;
const MAX_PAYLOAD_RAW = 20000; // ticketSchema payload.raw-Limit

// Verdikt → Ticket-decision (ticketSchema: '' | benign | suspicious | incident | fp).
const VERDICT_DECISION = { confirmed_malicious: 'incident', suspicious: 'suspicious', observed: '' };

// Honeypot-Sitzungs-Aktivität → Nexora Payload-Typ (ticketSchema PAYLOAD_TYPES).
// command → Command · download → URL · login/tunnel → Andere (kein spezifischerer Typ).
const ACTIVITY_PAYLOAD_TYPE = { command: 'Command', download: 'URL', login: 'Andere', tunnel: 'Andere' };

function asStr(v) { return v === undefined || v === null ? '' : String(v); }

// Sitzungs-Aktivität → eingebettete Ticket-payloads (Editor-Parität). Trägt den
// Befehl/Login/Download/Tunnel als sichtbares Artefakt ins Ticket, damit die
// Payload-/Commands-View nicht leer bleibt. Kein Passwort (per Contract nie vorhanden).
function buildPayloads(incident) {
  const acts = Array.isArray(incident.sessionActivity) ? incident.sessionActivity : [];
  const out = [];
  for (const a of acts) {
    if (!a || typeof a !== 'object' || typeof a.kind !== 'string') continue;
    const type = ACTIVITY_PAYLOAD_TYPE[a.kind] || 'Andere';
    const raw = asStr(a.value).slice(0, MAX_PAYLOAD_RAW);
    const fields = { kind: a.kind };
    if (a.user) fields.user = asStr(a.user).slice(0, MAX_FIELD);
    if (a.at) fields.at = asStr(a.at);
    out.push({ type, raw, fields });
    if (out.length >= MAX_PAYLOADS) break;
  }
  return out;
}

function buildDescription(inc) {
  const n = inc.network || {};
  const bytes = (n.bytesToServer != null || n.bytesToClient != null)
    ? `Bytes: ${n.bytesToServer ?? '?'} → / ← ${n.bytesToClient ?? '?'}` : '';
  return [
    `Cross-Domain-Vorfall — Verdikt: ${inc.verdict} (Severity ${inc.severity})`,
    `Domänen: ${(inc.domains || []).join(', ')}`,
    (n.srcIp || n.dstIp) ? `Netzwerk: ${n.srcIp || '?'}${n.dstPort || n.dstIp ? ` → ${n.dstIp || '?'}${n.dstPort ? ':' + n.dstPort : ''}` : ''}${n.protocol ? ' (' + n.protocol + ')' : ''}` : '',
    bytes,
    (inc.signatures && inc.signatures.length) ? `Signaturen: ${inc.signatures.join(' · ')}` : '',
    (inc.mitre && inc.mitre.length) ? `MITRE ATT&CK: ${inc.mitre.join(', ')}` : '',
    (inc.firewallActions && inc.firewallActions.length) ? `Firewall: ${inc.firewallActions.join(', ')}` : '',
    `Events: ${inc.eventCount}${inc.windowStart ? ` · Fenster ${inc.windowStart} – ${inc.windowEnd}` : ''}`,
    `Fusion-Key: ${inc.fusionKey}`,
  ].filter(Boolean).join('\n').slice(0, MAX_DESC);
}

function buildIocs(inc) {
  const set = new Set();
  for (const e of inc.entities || []) if (e && e.value) set.add(String(e.value));
  for (const s of inc.signatures || []) set.add(String(s));
  return [...set].join('\n').slice(0, MAX_FIELD);
}

class DataplaneIncidentAdapter extends BaseAdapter {
  constructor() { super('dataplane'); }

  validate(incident) {
    if (!incident || typeof incident !== 'object' || Array.isArray(incident)) {
      throw new ValidationError('FusedIncident muss ein JSON-Objekt sein');
    }
    const { error } = fusedIncidentSchema.validate(incident, { abortEarly: false });
    if (error) {
      throw new ValidationError('FusedIncident ungültig', error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      })));
    }
  }

  normalize(incident) {
    const n = incident.network || {};
    const title = `[${incident.verdict}] ${(incident.domains || []).join('+')} ${n.srcIp || '?'} → ${n.dstIp || '?'}`.slice(0, 200);
    const conf = typeof incident.confidence === 'number'
      ? Math.max(0, Math.min(100, Math.round(incident.confidence * 100))) : null;
    return {
      title,
      category: 'cross_domain_correlation',
      priority: incident.severity,            // gleiche Skala wie Wazuh (info…critical)
      source: 'dataplane',
      externalId: incident.incidentId,        // stabil/idempotent (Hash des Fusion-Keys)
      datetime: incident.windowEnd || incident.windowStart || new Date().toISOString(),
      // Netzwerk-5-Tuple/Bytes → flache Ticket-Felder, die das Analysis-Deck liest.
      srcIp: n.srcIp || '',
      dstIp: n.dstIp || '',
      attackerIp: n.srcIp || '',              // externe Quelle (Honeypot/Angreifer-Semantik)
      port: asStr(n.dstPort),
      protocol: asStr(n.protocol),
      bytesSent: asStr(n.bytesToServer),
      bytesRecv: asStr(n.bytesToClient),
      // Flow-Statistik fürs App-Map-Traffic: Pakete (Conntrack), Firewall-Action
      // (denied/permitted-Quelle), beobachtetes Zeitfenster + Event-Zahl.
      pktsSent: asStr(n.pktsToServer),
      pktsRecv: asStr(n.pktsToClient),
      firewallAction: asStr((incident.firewallActions || [])[0]),
      firstSeen: asStr(incident.windowStart),
      lastSeen: asStr(incident.windowEnd),
      eventCount: asStr(incident.eventCount),
      mitre: (incident.mitre || []).join(', ').slice(0, 200),
      // Verdikt → Analyst-Entscheidung + Confidence (0-100) fürs Deck.
      decision: VERDICT_DECISION[incident.verdict] || '',
      confidence: conf,
      // Hinweis: NICHT alertCount setzen — das ist der Wiederholungs-Zähler der Route
      // ((agg.alertCount||1)+1 je Re-Post). Die Anzahl gefuster Events steht in der
      // Description („Events: N"); alertCount=eventCount würde den Zähler verfälschen.
      description: buildDescription(incident),
      iocs: buildIocs(incident),
      // Honeypot-Sitzungs-Aktivität als eingebettete Payload-Artefakte (Deck-Payload-View).
      payloads: buildPayloads(incident),
    };
  }

  toTicketDraft(d) {
    return {
      title: d.title,
      category: d.category,
      priority: d.priority,
      // ADR-007: frisch eingehender Vorfall = offener, zugewiesener Case.
      state: 'OPEN',
      status: 'assigned',
      source: d.source,
      datetime: d.datetime,
      srcIp: d.srcIp,
      dstIp: d.dstIp,
      attackerIp: d.attackerIp,
      port: d.port,
      protocol: d.protocol,
      bytesSent: d.bytesSent,
      bytesRecv: d.bytesRecv,
      pktsSent: d.pktsSent,
      pktsRecv: d.pktsRecv,
      firewallAction: d.firewallAction,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      eventCount: d.eventCount,
      mitre: d.mitre,
      decision: d.decision,
      confidence: d.confidence,
      description: d.description,
      iocs: d.iocs,
      payloads: Array.isArray(d.payloads) ? d.payloads : [],
      offenseId: d.externalId,
    };
  }
}

module.exports = { DataplaneIncidentAdapter };
