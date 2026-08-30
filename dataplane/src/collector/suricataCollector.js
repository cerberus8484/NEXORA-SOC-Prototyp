'use strict';

// ─────────────────────────────────────────────────────────────────────────
// IDS-Collector — Suricata eve.json (Top-Level-Schema, ein JSON-Objekt je Zeile).
// Quelle: `eve.json` des Sensors (event_type "alert" = Detektion, "flow" = Telemetrie).
//
// Disziplin (wie suricataFlowReader, ADR-009): nur was der IDS liefert — L3/L4,
// Bytes/Pakete, Signatur/Kategorie/Severity, ggf. MITRE. NICHT: NAT, Firewall-Verdikt,
// Host-Inventory, Reputation (Anreicherung übernimmt die Engine).
//
// PFLICHT-Filter: Asset-Scope. Nur Events, deren src ODER dst ein Asset ist.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

function isEmpty(v) { return v === undefined || v === null || v === ''; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function toIso(ts) { const d = new Date(ts); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }

const DEFAULT_EVENT_TYPES = ['alert', 'flow'];

/**
 * @param {{ instanceId:string, assetIps:string[], parserVersion?:string, eventTypes?:string[] }} opts
 *   assetIps   = Pflicht-Allowlist (nicht-leer) — SOC-Scope statt Flow-Archiv.
 *   eventTypes = erlaubte Suricata-event_type (default ['alert','flow']). Auf
 *                ['alert'] setzen, um reine flow-Telemetrie zu verwerfen — sonst
 *                wird auf einem Public-Honeypot jeder beobachtete Scan-Flow ein
 *                Ticket (Ticket-Flut). Leeres/ungültiges Array → Default.
 */
function createSuricataCollector({ instanceId, assetIps, parserVersion = '0.1.0', eventTypes } = {}) {
  if (!instanceId) throw new Error('suricataCollector: instanceId required');
  if (!Array.isArray(assetIps) || assetIps.length === 0) {
    throw new Error('suricataCollector: assetIps (nicht-leeres Array) ist Pflicht (Asset-Scope)');
  }
  const allowedTypes = new Set(
    Array.isArray(eventTypes) && eventTypes.length > 0 ? eventTypes : DEFAULT_EVENT_TYPES
  );
  const assets = new Set(assetIps);
  const inScope = (src, dst) => assets.has(src) || assets.has(dst);

  return {
    name: `ids-suricata-${instanceId}`,
    domain: 'ids',
    source: { type: 'ids', vendor: 'suricata', instanceId },
    parserVersion,
    normalize(line) {
      let doc;
      try { doc = typeof line === 'string' ? JSON.parse(line) : line; } catch { return null; }
      if (!doc || typeof doc !== 'object') return null;
      if (!allowedTypes.has(doc.event_type)) return null;                        // Gate 1: erlaubte event_type
      const src = isEmpty(doc.src_ip) ? null : String(doc.src_ip);
      const dst = isEmpty(doc.dest_ip) ? null : String(doc.dest_ip);
      if (!inScope(src, dst)) return null;                                       // Gate 2: Asset-Scope

      const fl = (doc.flow && typeof doc.flow === 'object') ? doc.flow : {};
      const entities = [];
      if (src) entities.push({ type: 'ip', value: src, role: 'source' });
      if (dst && dst !== src) entities.push({ type: 'ip', value: dst, role: 'destination' });

      const part = {
        observedAt: toIso(doc.timestamp || doc['@timestamp']),
        rawHash: crypto.createHash('sha256').update(typeof line === 'string' ? line : JSON.stringify(doc)).digest('hex'),
        rawRef: `suricata:${doc.event_type}:${doc.flow_id || doc.community_id || src + '->' + dst}`,
        entities,
        network: {
          srcIp: src, dstIp: dst,
          srcPort: toNum(doc.src_port), dstPort: toNum(doc.dest_port),
          protocol: isEmpty(doc.proto) ? null : String(doc.proto).toLowerCase(),
          bytesToServer: toNum(fl.bytes_toserver), bytesToClient: toNum(fl.bytes_toclient),
          pktsToServer: toNum(fl.pkts_toserver), pktsToClient: toNum(fl.pkts_toclient),
          appProtocol: isEmpty(doc.app_proto) ? null : String(doc.app_proto),
        },
        // IDS-Severity 1 (hoch) … 3 (niedrig) → confidence nicht erfunden: alert=1, flow=0.6.
        confidence: doc.event_type === 'alert' ? 1 : 0.6,
      };

      if (doc.event_type === 'alert' && doc.alert && typeof doc.alert === 'object') {
        const a = doc.alert;
        const mitre = a.metadata && a.metadata.mitre_technique_id ? a.metadata.mitre_technique_id : undefined;
        part.alert = {
          signature: isEmpty(a.signature) ? null : String(a.signature),
          category: isEmpty(a.category) ? null : String(a.category),
          severity: toNum(a.severity),
          signatureId: toNum(a.signature_id),
          mitre: Array.isArray(mitre) ? mitre : undefined,
        };
      }
      return part;
    },
  };
}

module.exports = { createSuricataCollector };
