'use strict';

// Brücke Collector → EventEnvelopeV1. Nimmt die NormalizedPart eines Collectors
// + dessen Identität und baut einen contract-konformen Envelope (server-seitige
// Felder bleiben absent — die setzt der Intake-Server). eventId = UUIDv4 (node:crypto).
const crypto = require('node:crypto');

/**
 * @param {{source:object, parserVersion:string}} collector
 * @param {{observedAt?:string, rawHash:string, rawRef:string, entities?:any[], confidence?:number, warnings?:string[]}} part
 * @param {{ eventId?:string, now?:string }} [opts]
 * @returns {object} EventEnvelopeV1 (roh, Collector-Sicht)
 */
function buildEnvelope(collector, part, { eventId, now } = {}) {
  const env = {
    schemaVersion: '1.0',
    eventId: eventId || crypto.randomUUID(),
    observedAt: part.observedAt || now || new Date().toISOString(),
    source: { type: collector.source.type, vendor: collector.source.vendor, instanceId: collector.source.instanceId },
    raw: { hash: part.rawHash, ref: part.rawRef },
    provenance: {
      parserVersion: collector.parserVersion,
      confidence: typeof part.confidence === 'number' ? part.confidence : 1,
    },
  };
  if (Array.isArray(part.warnings) && part.warnings.length) env.provenance.warnings = part.warnings;
  // normalized: Entities + domänenspezifische Blöcke (Allowlist). Der Contract deckelt
  // nur `entities`; die übrigen Blöcke sind je Domäne optional:
  //   network  (Flow-5-Tuple + Bytes/Pakete, ggf. direction)  · alle Flow-/FW-/IDS-Quellen
  //   alert    (Suricata: signature/category/severity/signatureId/mitre)
  //   detection(Wazuh: ruleId/level/severity/signature/groups/mitre)
  //   firewall (OPNsense: action/interface/direction)
  //   agent    (Wazuh: meldender Sensor name/ip)
  //   activity (Cowrie: Sitzungs-Schritt — command/login/download/tunnel, für die Ticket-Payload-View)
  const NORMALIZED_BLOCKS = ['network', 'alert', 'detection', 'firewall', 'agent', 'activity'];
  const normalized = {};
  if (Array.isArray(part.entities)) normalized.entities = part.entities;
  for (const key of NORMALIZED_BLOCKS) {
    if (part[key] && typeof part[key] === 'object') normalized[key] = part[key];
  }
  if (Object.keys(normalized).length) env.normalized = normalized;
  return env;
}

module.exports = { buildEnvelope };
