'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 2b.2 (+ 2b.4) — Orchestrierung: Honeypot-Sessions für ein Ticket bauen.
//
// Verbindet Slice 1 (Cowrie-Flows) → 2b.1 (Fetch) → Slice 2 (Aggregation).
// Reines Modul: der Fetch wird injiziert (`fetchSessions`), damit es ohne Indexer
// testbar bleibt; die Route reicht nur `wazuhIndexerClient.ticketHoneypotSessions` herein.
//
// 2b.4-Korrektur: Das Gate prüft NICHT mehr auf vorhandene Cowrie-`network_flows`
// (die echten indexierten Events sind login/command/client.version — KEIN
// session.connect/closed). Stattdessen gaten wir auf echte Cowrie-QUELLereignisse
// und leiten den Fetch-Scope direkt daraus ab:
//   data.eventid startsWith "cowrie."  AND  data.src_ip vorhanden  AND  eindeutiger agent.id
//
// Feste Regeln:
//  - agentId NUR aus belegtem Cowrie-Event (raw _source.agent.id), eindeutig — NIE offenseId.
//  - Angreifer-IP/Fenster/Session aus den Cowrie-Events, nie aus ticket.srcIp/agent.ip.
//  - Soft-Fail: jeder Fehler → leeres Ergebnis (kein Throw).
// ─────────────────────────────────────────────────────────────────────────

const { aggregateHoneypotSessions } = require('./honeypotSessionNormalizer');

function isCowrieRawEvent(src) {
  const eid = src && src.data && src.data.eventid;
  return typeof eid === 'string' && eid.startsWith('cowrie.');
}
function isCowrieSourceWithIp(src) {
  const ip = src && src.data && src.data.src_ip;
  return isCowrieRawEvent(src) && ip !== undefined && ip !== null && String(ip) !== '';
}

// agentId NUR aus belegten Cowrie-Events. Eindeutig (genau eine agent.id) → belastbar,
// sonst null (keine/mehrdeutige Quelle → kein Fetch).
function deriveHoneypotAgentId(sources = []) {
  const ids = new Set();
  for (const src of sources) {
    if (!isCowrieRawEvent(src)) continue;
    const id = src.agent && src.agent.id;
    if (id !== undefined && id !== null && String(id) !== '') ids.add(String(id));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

// Zeitfenster aus den Cowrie-Events (data.timestamp bevorzugt, sonst @timestamp).
function deriveWindowFromEvents(events = []) {
  const ts = [];
  for (const e of events) {
    const d = (e && e.data) || {};
    const t = d.timestamp || (e && e['@timestamp']);
    if (t) ts.push(String(t));
  }
  if (ts.length === 0) return { firstSeen: null, lastSeen: null };
  ts.sort();
  return { firstSeen: ts[0], lastSeen: ts[ts.length - 1] };
}

function distinct(values) {
  return [...new Set(values.filter((v) => v !== undefined && v !== null && String(v) !== ''))];
}

/**
 * Honeypot-Sessions eines Tickets bauen — als SEPARATER Block (nie in flows).
 * @param {object} args
 * @param {object[]} args.sources  rohe _source-Events (für Gate + belegten agent.id + Scope)
 * @param {(q:{agentId,srcIp,firstSeen,lastSeen,sessionId?})=>Promise<{events:object[]}|null>} args.fetchSessions
 * @returns {Promise<{honeypotSessions: object[], reason?: string}>}
 */
async function buildHoneypotSessions({ sources = [], fetchSessions } = {}) {
  const empty = (reason) => ({ honeypotSessions: [], ...(reason ? { reason } : {}) });
  if (typeof fetchSessions !== 'function') return empty('no_fetcher');

  // Gate: echte Cowrie-Quellereignisse mit belastbarer src_ip.
  const cowrieEvents = (Array.isArray(sources) ? sources : []).filter(isCowrieSourceWithIp);
  if (cowrieEvents.length === 0) return empty('no_cowrie_events');

  // agentId NUR aus belegtem Cowrie-Event.
  const agentId = deriveHoneypotAgentId(cowrieEvents);
  if (!agentId) return empty('no_agent');

  const { firstSeen, lastSeen } = deriveWindowFromEvents(cowrieEvents);
  if (!firstSeen && !lastSeen) return empty('no_time_window');

  const attackerIps = distinct(cowrieEvents.map((e) => e.data && e.data.src_ip));
  const sessionIds = distinct(cowrieEvents.map((e) => e.data && e.data.session));
  const onlySession = sessionIds.length === 1 ? sessionIds[0] : null;

  // Fetch je distinct Angreifer-IP, Soft-Fail pro IP.
  const events = [];
  let hadError = false;
  for (const srcIp of attackerIps) {
    try {
      const res = await fetchSessions({ agentId, srcIp, firstSeen, lastSeen, ...(onlySession ? { sessionId: onlySession } : {}) });
      if (res && Array.isArray(res.events)) events.push(...res.events);
    } catch {
      hadError = true;
    }
  }
  if (events.length === 0) return empty(hadError ? 'fetch_failed' : 'no_session_events');

  return { honeypotSessions: aggregateHoneypotSessions(events) };
}

module.exports = { buildHoneypotSessions, deriveHoneypotAgentId, deriveWindowFromEvents };
