'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 3a — Correlated Exposure Stitching (reine Engine, ADR-034).
//
// Verbindet eine honeypot_session (bzw. partiellen Cowrie-Flow) mit einem
// OPNsense-Firewall-Event, NUR wenn die Übereinstimmung eindeutig plausibel ist.
//
// HART (ADR-034): Das Ergebnis ist eine KORRELIERTE Ableitung, KEINE behauptete
// NAT-Translation. `natVerified` ist immer false, `provenance: "correlated"`.
// Mehrdeutigkeit wird NICHT geraten (→ confidence "none"); kein Kandidat → kein Eintrag.
//
// Rein (keine Fetches, keine DB) → testbar. Fetch + Route-Wiring folgen in 3b.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 120000;       // ± um das Session-Fenster
const DEFAULT_HIGH_WINDOW_MS = 30000;   // „sehr kleine" Zeitdiff für high
const DEFAULT_SERVICE_PORTS = { ssh: [22, 2222], telnet: [23, 2323] };

function lc(v) { return v === undefined || v === null ? null : String(v).toLowerCase(); }
function num(v) { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function ms(v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
function serviceIsTcp(service) { const s = lc(service); return s === 'ssh' || s === 'telnet'; }

/**
 * Honeypot-Sessions mit Firewall-Flows korrelieren (Exposure-Stitching).
 * @param {object[]} cowrieSessions  honeypot_session-Objekte (sourceIp/service/destinationPort/firstSeen/lastSeen)
 * @param {object[]} firewallFlows   normalisierte Firewall-Flows (+ optional eventId)
 * @param {{windowMs?:number, highWindowMs?:number, servicePorts?:object}} [options]
 * @returns {object[]} exposureCorrelations (siehe ADR-034 / Datenmodell)
 */
function correlateHoneypotExposure(cowrieSessions = [], firewallFlows = [], options = {}) {
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : DEFAULT_WINDOW_MS;
  const highWindowMs = Number.isFinite(options.highWindowMs) ? options.highWindowMs : DEFAULT_HIGH_WINDOW_MS;
  const servicePorts = options.servicePorts || DEFAULT_SERVICE_PORTS;

  const fws = (Array.isArray(firewallFlows) ? firewallFlows : [])
    .filter((f) => f && (f.sourceType === 'firewall' || f.sourceType === undefined));
  const out = [];

  for (const s of (Array.isArray(cowrieSessions) ? cowrieSessions : [])) {
    const srcIp = s && s.sourceIp;
    if (!srcIp) continue;                    // kein Anker → kein Eintrag
    if (!serviceIsTcp(s.service)) continue;  // nur ssh/telnet ⇒ tcp; sonst kein belastbares Mapping
    const lo = ms(s.firstSeen) != null ? ms(s.firstSeen) : ms(s.lastSeen);
    const hi = ms(s.lastSeen) != null ? ms(s.lastSeen) : ms(s.firstSeen);
    if (lo == null || hi == null) continue;  // kein Zeitfenster → kein Eintrag

    const sessPort = num(s.destinationPort);
    const allowedPorts = sessPort != null ? [sessPort] : (servicePorts[lc(s.service)] || []);

    // Kandidaten: gleiche externe IP + tcp + Zeitfenster + Port-Constraint.
    const cands = fws.filter((f) => {
      if (lc(f.sourceIp) !== lc(srcIp)) return false;
      if (lc(f.protocol) !== 'tcp') return false;
      const t = ms(f.timestamp);
      if (t == null || t < lo - windowMs || t > hi + windowMs) return false;
      const dp = num(f.destinationPort);
      if (dp == null || !allowedPorts.includes(dp)) return false;
      return true;
    });
    if (cands.length === 0) continue;        // kein Kandidat → kein Eintrag

    // Logische Kandidaten nach (dstip, dstport, protocol) — identische Wiederholungen = EINER.
    const groups = new Map();
    for (const f of cands) {
      const key = `${lc(f.destinationIp)}|${num(f.destinationPort)}|${lc(f.protocol)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }

    const base = {
      sessionId: s.sessionId, relatedFlowSessionId: s.sessionId, remoteSourceIp: srcIp,
      correlationType: 'firewall_to_honeypot', natVerified: false, provenance: 'correlated',
    };

    if (groups.size > 1) {
      // Mehrdeutig → transparenter none-Eintrag, KEINE Firewall-Felder übernehmen.
      out.push({
        ...base, firewallEventId: null, firewallTimestamp: null, firewallDestinationIp: null,
        firewallDestinationPort: null, firewallProtocol: null, firewallAction: null,
        confidence: 'none', missingReason: 'no_unique_firewall_match',
      });
      continue;
    }

    // Genau ein logischer Kandidat → Repräsentant = frühestes Event der Gruppe.
    const group = [...groups.values()][0].slice().sort((a, b) => (ms(a.timestamp) || 0) - (ms(b.timestamp) || 0));
    const rep = group[0];
    const repT = ms(rep.timestamp);
    const timeDiff = (repT != null && repT >= lo && repT <= hi) ? 0 : Math.min(Math.abs((repT || 0) - lo), Math.abs((repT || 0) - hi));
    const portAuthoritative = sessPort != null;            // Port kam direkt aus Cowrie, nicht aus Mapping
    const confidence = (portAuthoritative && timeDiff <= highWindowMs) ? 'high' : 'medium';

    out.push({
      ...base,
      firewallEventId: rep.eventId != null ? rep.eventId : (rep.id != null ? rep.id : null),
      firewallTimestamp: rep.timestamp != null ? rep.timestamp : null,
      firewallDestinationIp: rep.destinationIp != null ? rep.destinationIp : null,
      firewallDestinationPort: num(rep.destinationPort),
      firewallProtocol: lc(rep.protocol),
      firewallAction: rep.action != null ? rep.action : null,
      confidence, missingReason: null,
    });
  }
  return out;
}

// Gemeinsames Fenster über alle Sessions (für den Firewall-Fetch).
function sessionWindow(sessions) {
  const firsts = sessions.map((s) => s && s.firstSeen).filter(Boolean).map(String).sort();
  const lasts = sessions.map((s) => s && s.lastSeen).filter(Boolean).map(String).sort();
  return { firstSeen: firsts[0] || null, lastSeen: lasts[lasts.length - 1] || null };
}

/**
 * Orchestrator (Slice 3b): aus honeypot_sessions die Firewall-Kandidaten holen
 * (injizierter, read-only Fetch) und korrelieren. Rein/testbar; die Route reicht nur
 * `wazuhIndexerClient.ticketFirewallFlows` herein.
 * @param {object} args
 * @param {object[]} args.honeypotSessions
 * @param {(q:{srcIp,firstSeen,lastSeen})=>Promise<{flows:object[]}|null>} args.fetchFirewallFlows
 * @param {object} [args.options]
 * @returns {Promise<object[]>} exposureCorrelations (siehe ADR-034)
 */
async function buildExposureCorrelations({ honeypotSessions = [], fetchFirewallFlows, options = {} } = {}) {
  if (typeof fetchFirewallFlows !== 'function') return [];
  const sessions = Array.isArray(honeypotSessions) ? honeypotSessions : [];
  if (sessions.length === 0) return [];
  const ips = [...new Set(sessions.map((s) => s && s.sourceIp).filter(Boolean))];
  if (ips.length === 0) return [];

  const { firstSeen, lastSeen } = sessionWindow(sessions);
  const firewallFlows = [];
  for (const srcIp of ips) {
    try {
      const res = await fetchFirewallFlows({ srcIp, firstSeen, lastSeen });
      if (res && Array.isArray(res.flows)) firewallFlows.push(...res.flows);
    } catch {
      /* Soft-Fail pro IP — eine schlechte Abfrage kippt die Korrelation nicht. */
    }
  }
  return correlateHoneypotExposure(sessions, firewallFlows, options);
}

module.exports = { correlateHoneypotExposure, buildExposureCorrelations, sessionWindow };
