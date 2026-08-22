'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-3 — Network-Correlation-Sektion (CorrelationResult.network)
//
// Nimmt rohe Indexer-_source-Events (Firewall UND Sysmon Event 3), normalisiert
// jedes über den flowNormalizer in EIN Flow-Modell und leitet minimale
// Zusammenfassungen ab. Bewusst schlank gehalten (CE-3): flows + topConversations
// + source/destinationSummary + gaps — keine schwere Analytics.
//
// Rein (keine Fetches) → gut testbar. Der Aufrufer (Route/Service) holt die
// rohen _source-Objekte aus dem Indexer und reicht sie hier hinein.
// ─────────────────────────────────────────────────────────────────────────

const { normalizeFlow } = require('./flowNormalizer');
const { enrichFlowsWithInventory } = require('./flowInventoryEnrichment');

// Newest-first; null-Timestamps ans Ende.
function byTimestampDesc(a, b) {
  return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
}

// Top-Verbindungen aus normalisierten Flows (src→dst:port/proto, Häufigkeit).
function topConversations(flows, max = 5) {
  const groups = new Map();
  for (const f of flows) {
    if (!f.sourceIp || !f.destinationIp) continue;
    const key = `${f.sourceIp}|${f.destinationIp}|${f.protocol || '?'}|${f.destinationPort ?? ''}`;
    const cur = groups.get(key);
    if (cur) cur.count += 1;
    else groups.set(key, {
      sourceIp: f.sourceIp, destinationIp: f.destinationIp,
      protocol: f.protocol || null, destinationPort: f.destinationPort ?? null, count: 1,
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

// Verteilung eines Feldes (distinct + Top-N), z. B. Source-/Destination-IPs.
function summarize(flows, field, max = 10) {
  const counts = new Map();
  for (const f of flows) { const v = f[field]; if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
  return { distinct: counts.size, top };
}

// Lücken: welche Felder fehlen wie oft und warum (aus den Provenances aggregiert).
function collectGaps(flows) {
  const seen = new Map();
  for (const f of flows) {
    for (const [field, prov] of Object.entries(f.provenance || {})) {
      if (prov && prov.missingReason) {
        const k = `${field}|${prov.missingReason}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
  }
  return [...seen.entries()].map(([k, count]) => {
    const [field, missingReason] = k.split('|');
    return { field, missingReason, count };
  });
}

/**
 * Network-Sektion des CorrelationResult aus rohen Indexer-_source-Events bauen.
 * @param {object[]} rawSources  _source-Objekte (Firewall + Sysmon Event 3 gemischt)
 * @param {{ now?: string, inventoryLookup?: ({ byIp: object }|null) }} [opts]
 *        inventoryLookup (CE-4) optional: ist er gesetzt, werden die Flows mit
 *        Host/MAC/Host-Interface aus dem Wazuh-Inventar angereichert. Fehlt er,
 *        bleibt das bisherige Verhalten (missingReason inventory_not_loaded).
 * @returns {{ flows: object[], topConversations: object[], sourceSummary: object, destinationSummary: object, gaps: object[] }}
 */
// Slice 2b.4: Cowrie erzeugt pro Event (login/command/…) eine Beziehung → auf EINE
// pro sessionId deduplizieren, bevorzugt die mit Ziel-IP (vollständigerer Flow).
// Andere Quellen (firewall/sysmon haben keine sessionId) bleiben unberührt.
function dedupeCowrieBySession(flows) {
  const firstBySession = new Map();
  const out = [];
  for (const f of flows) {
    if (f.sourceType !== 'cowrie' || !f.sessionId) { out.push(f); continue; }
    const prev = firstBySession.get(f.sessionId);
    if (!prev) { firstBySession.set(f.sessionId, f); out.push(f); continue; }
    if (!prev.destinationIp && f.destinationIp) {
      const idx = out.indexOf(prev);
      if (idx >= 0) out[idx] = f;
      firstBySession.set(f.sessionId, f);
    }
  }
  return out;
}

function buildNetworkCorrelation(rawSources = [], { now, inventoryLookup = null } = {}) {
  const list = Array.isArray(rawSources) ? rawSources : [];
  let flows = list
    .map((s) => normalizeFlow(s, { now }))
    // Nur echte Netzwerk-Flows: reine Host-Events (Sysmon FileCreate/WMI → 'unknown',
    // ohne Source-/Ziel-IP) sind KEINE Flows und würden den Network-Tab vermüllen.
    .filter((f) => f.sourceIp || f.destinationIp)
    .sort(byTimestampDesc);
  flows = dedupeCowrieBySession(flows);
  // CE-4: nur anreichern, wenn ein Lookup vorhanden ist. enrichFlows überschreibt
  // bestehende Werte NICHT (setIfEmpty) → firewallInterface bleibt unangetastet.
  if (inventoryLookup) {
    flows = enrichFlowsWithInventory(flows, inventoryLookup, { now });
  }
  return {
    flows,
    topConversations: topConversations(flows),
    sourceSummary: summarize(flows, 'sourceIp'),
    destinationSummary: summarize(flows, 'destinationIp'),
    gaps: collectGaps(flows),
  };
}

module.exports = { buildNetworkCorrelation, topConversations, summarize, collectGaps };
