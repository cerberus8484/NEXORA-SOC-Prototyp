'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — Nexora Suricata Flow Reader.
//
// Liest den GETRENNTEN Telemetrie-Index `suricata-flows-*` (rohes EVE-Schema:
// Felder TOP-LEVEL, KEIN data.*-Wrapper — wie der eigene Sensor-Filebeat sie
// schreibt). Bewusst getrennt vom Wazuh-Alert-Pfad und vom `flowNormalizer.js`
// (der den data.*-gewrappten Wazuh-Indexer liest, SOURCE wazuh_indexer).
//
// Reiner Adapter: keine Fetches, kein Indexer-/Filebeat-/Wazuh-Zugriff hier.
//
// Disziplin (ADR-009 — nie Werte erfinden): ein IDS-Flow liefert L3/L4 +
// Bytes/Pakete + Flow-Zeiten. NICHT: NAT, Firewall-Verdikt, Host-Inventory,
// Prozesskontext, DNS/Reputation → in `notProvided` dokumentiert, NICHT als
// Pseudo-Felder erfunden. `in_iface` ist Sensor-Capture-Kontext, NICHT ein
// Firewall-Interface. Fehlt ein lieferbares Feld → null + missingReason.
//
// PFLICHT-Filter: Asset-/Honeypot-Scope. Nur Flows, deren Quelle ODER Ziel ein
// definiertes Asset ist, werden übernommen (sonst null). `assetIps` ist
// erforderlich und nicht-leer (fail-fast) — der getrennte Index soll SOC-
// Telemetrie bleiben, kein allgemeines Flow-Archiv.
// ─────────────────────────────────────────────────────────────────────────

const SOURCE = 'suricata_flow_index';

// Kategorien, die diese Quelle prinzipiell NICHT liefert (Anreicherung anderswo:
// Firewall-Stitching · CE-4 Host-Inventory · CE-5 DNS/Threat-Intel).
const NOT_PROVIDED = ['nat', 'firewall_verdict', 'host_inventory', 'process', 'dns_reputation'];

function isEmpty(v) { return v === undefined || v === null || v === ''; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function assertAssetIps(assetIps) {
  if (!Array.isArray(assetIps) || assetIps.length === 0) {
    throw new Error('readSuricataFlow: assetIps (nicht-leeres Array) ist Pflicht (Asset-Scope-Filter)');
  }
}

// Asset-Scope: trifft src ODER dest ein Asset?
function assetScopeOf(srcIp, destIp, assetIps) {
  const assets = [];
  const srcHit = !isEmpty(srcIp) && assetIps.includes(srcIp);
  const dstHit = !isEmpty(destIp) && assetIps.includes(destIp);
  if (srcHit) assets.push(srcIp);
  if (dstHit && destIp !== srcIp) assets.push(destIp);
  if (!srcHit && !dstHit) return null;
  const matched = srcHit && dstHit ? 'both' : srcHit ? 'source' : 'destination';
  return { matched, assets };
}

/**
 * Einen rohen EVE-Flow (suricata-flows-*) in Nexoras Flow-Modell überführen.
 * @param {object} doc          Roh-Dokument (_source) mit Top-Level-EVE-Feldern.
 * @param {{ assetIps: string[], now?: string }} opts  assetIps = Pflicht-Allowlist.
 * @returns {object|null} normalisierter Flow, oder null (kein flow / out of scope).
 */
function readSuricataFlow(doc, { assetIps, now } = {}) {
  assertAssetIps(assetIps);
  if (!doc || typeof doc !== 'object') return null;
  if (doc.event_type !== 'flow') return null;            // Gate 1: nur echte Flows

  const scope = assetScopeOf(doc.src_ip, doc.dest_ip, assetIps);
  if (!scope) return null;                               // Gate 2: Pflicht Asset-Scope

  const collectedAt = now || new Date().toISOString();
  const fl = (doc.flow && typeof doc.flow === 'object') ? doc.flow : {};

  const provenance = {};
  const missingReason = {};
  const flow = {
    source: SOURCE,
    eventType: 'flow',
    assetScope: scope,
    notProvided: [...NOT_PROVIDED],
    provenance,
    missingReason,
  };

  // value-Feld setzen: echter Wert → high-confidence; sonst null + field_missing.
  const set = (field, value, fieldPath) => {
    if (isEmpty(value)) {
      flow[field] = null;
      provenance[field] = { source: SOURCE, fieldPath, confidence: null, collectedAt, missingReason: 'field_missing' };
      missingReason[field] = 'field_missing';
    } else {
      flow[field] = value;
      provenance[field] = { source: SOURCE, fieldPath, confidence: 'high', collectedAt };
    }
  };
  // additives Feld: NUR setzen wenn vorhanden (kein Platzhalter, kein missingReason).
  const setIfPresent = (field, value, fieldPath) => {
    if (!isEmpty(value)) {
      flow[field] = value;
      provenance[field] = { source: SOURCE, fieldPath, confidence: 'high', collectedAt };
    }
  };

  // 5-Tuple (top-level, roh)
  set('sourceIp', isEmpty(doc.src_ip) ? null : String(doc.src_ip), 'src_ip');
  set('sourcePort', toNum(doc.src_port), 'src_port');
  set('destinationIp', isEmpty(doc.dest_ip) ? null : String(doc.dest_ip), 'dest_ip');
  set('destinationPort', toNum(doc.dest_port), 'dest_port');
  set('protocol', isEmpty(doc.proto) ? null : String(doc.proto).toLowerCase(), 'proto');

  // Bytes/Pakete — roh (toServer/toClient), Richtung NICHT interpretiert.
  set('bytesToServer', toNum(fl.bytes_toserver), 'flow.bytes_toserver');
  set('bytesToClient', toNum(fl.bytes_toclient), 'flow.bytes_toclient');
  set('pktsToServer', toNum(fl.pkts_toserver), 'flow.pkts_toserver');
  set('pktsToClient', toNum(fl.pkts_toclient), 'flow.pkts_toclient');

  // Flow-Zeiten
  set('flowStart', isEmpty(fl.start) ? null : String(fl.start), 'flow.start');
  set('flowEnd', isEmpty(fl.end) ? null : String(fl.end), 'flow.end');
  set('connectionState', isEmpty(fl.state) ? null : String(fl.state).toLowerCase(), 'flow.state');

  // durationMs: aus start/end, sonst aus age (s→ms), sonst ehrlich fehlend.
  const startMs = Date.parse(fl.start);
  const endMs = Date.parse(fl.end);
  const ageNum = Number(fl.age);
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    set('durationMs', Math.max(0, endMs - startMs), 'flow.start/end');
  } else if (!isEmpty(fl.age) && Number.isFinite(ageNum)) {
    set('durationMs', Math.round(ageNum * 1000), 'flow.age');
  } else {
    set('durationMs', null, 'flow.start/end');
  }

  // timestamp: EVE-Event-Zeit (top-level), Fallback @timestamp.
  if (!isEmpty(doc.timestamp)) {
    flow.timestamp = String(doc.timestamp);
    provenance.timestamp = { source: SOURCE, fieldPath: 'timestamp', confidence: 'high', collectedAt };
  } else if (!isEmpty(doc['@timestamp'])) {
    flow.timestamp = String(doc['@timestamp']);
    provenance.timestamp = { source: SOURCE, fieldPath: '@timestamp', confidence: 'medium', collectedAt };
  } else {
    flow.timestamp = null;
    provenance.timestamp = { source: SOURCE, fieldPath: 'timestamp', confidence: null, collectedAt, missingReason: 'field_missing' };
    missingReason.timestamp = 'field_missing';
  }

  // Additive Metadaten — nur wenn vorhanden.
  setIfPresent('appProtocol', isEmpty(doc.app_proto) ? null : String(doc.app_proto), 'app_proto');
  setIfPresent('flowId', isEmpty(doc.flow_id) ? null : String(doc.flow_id), 'flow_id');
  setIfPresent('communityId', isEmpty(doc.community_id) ? null : String(doc.community_id), 'community_id');
  // Sensor-Capture-Interface (NICHT Firewall-Interface).
  setIfPresent('inIface', isEmpty(doc.in_iface) ? null : String(doc.in_iface), 'in_iface');

  return flow;
}

/**
 * Batch: rohe EVE-Dokumente lesen, non-flow + out-of-scope verwerfen.
 * @param {object[]} docs
 * @param {{ assetIps: string[], now?: string }} opts
 * @returns {object[]} nur übernommene Asset-Flows.
 */
function readSuricataFlows(docs, opts = {}) {
  assertAssetIps(opts.assetIps);
  if (!Array.isArray(docs)) return [];
  const out = [];
  for (const d of docs) {
    const f = readSuricataFlow(d, opts);
    if (f) out.push(f);
  }
  return out;
}

module.exports = { readSuricataFlow, readSuricataFlows, SOURCE, NOT_PROVIDED };
