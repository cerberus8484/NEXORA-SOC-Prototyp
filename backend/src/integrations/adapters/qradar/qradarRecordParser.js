'use strict';

// ─────────────────────────────────────────────────────────────────────────
// QRadar Record Parser (quellunabhängig)
//
// Nimmt einen ROHEN flachen QRadar-Record — Log-Event ODER Netzwerk-Flow,
// egal ob aus Ariel-AQL (/api/ariel/searches) oder einem Webhook — und
// gliedert ALLE Felder strukturiert auf. QRadar liefert je nach Quelle
// unterschiedliche Schreibweisen (sourceip/SourceIP), deshalb alias- und
// case-robuster Zugriff.
//
// Rein (keine Seiteneffekte, kein process.env) → gut testbar. Erhält die
// Rohdaten vollständig (`fields` + `raw`) für Traceability (ADR-009).
// ─────────────────────────────────────────────────────────────────────────

const { mapTimestamp } = require('./qradarMapper');

// Flow-Marker: distinktive Felder, die NUR Flows tragen (Byte-/Paketzähler,
// Flow-Richtung, Application, Paket-Zeitfenster).
const FLOW_MARKERS = [
  'sourcebytes', 'destinationbytes', 'sourcepackets', 'destinationpackets',
  'flowdirection', 'firstpackettime', 'lastpackettime', 'applicationid',
];
// Event-Marker: typische Log-Event-Felder.
const EVENT_MARKERS = ['qid', 'logsourceid', 'qidname', 'categoryname', 'starttime'];

// Record auf ein lowercased Key→Value-Lookup reduzieren (einmalig).
function lowerKeyMap(rec) {
  const map = new Map();
  if (!rec || typeof rec !== 'object') return map;
  for (const [k, v] of Object.entries(rec)) {
    map.set(String(k).toLowerCase(), v);
  }
  return map;
}

// Ersten nicht-leeren Wert aus einer Alias-Liste holen (case-insensitiv).
function pick(map, aliases) {
  for (const alias of aliases) {
    const v = map.get(alias.toLowerCase());
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function pickNumber(map, aliases) {
  const v = pick(map, aliases);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickString(map, aliases) {
  const v = pick(map, aliases);
  return v === undefined ? '' : String(v);
}

/**
 * Record-Typ bestimmen. Expliziter Typ (Parameter) gewinnt; sonst Heuristik:
 * Flow-Marker zuerst (distinktiv), dann Event-Marker, Default 'event'.
 * @returns {'event'|'flow'}
 */
function detectRecordType(rec, explicit) {
  if (explicit === 'event' || explicit === 'flow') return explicit;
  const map = lowerKeyMap(rec);
  if (FLOW_MARKERS.some((m) => map.has(m))) return 'flow';
  if (EVENT_MARKERS.some((m) => map.has(m))) return 'event';
  return 'event';
}

// Netzwerk-Block (5-Tuple + MAC + flow-spezifische Felder) aufgliedern.
function parseNetwork(map, type) {
  const network = {
    srcIp:    pickString(map, ['sourceip', 'src_ip', 'srcip', 'source_address']),
    dstIp:    pickString(map, ['destinationip', 'dest_ip', 'dstip', 'destination_address']),
    srcPort:  pickNumber(map, ['sourceport', 'src_port', 'srcport']),
    dstPort:  pickNumber(map, ['destinationport', 'dest_port', 'dstport']),
    srcMac:   pickString(map, ['sourcemac', 'src_mac', 'srcmac']),
    dstMac:   pickString(map, ['destinationmac', 'dest_mac', 'dstmac']),
    protocol: pickString(map, ['protocolname', 'protocol', 'protocolid', 'protocol_id']),
  };

  if (type === 'flow') {
    network.direction   = pickString(map, ['flowdirection', 'flow_direction', 'direction']);
    network.application  = pickString(map, ['application', 'applicationname', 'applicationid', 'application_id']);
    network.bytes   = {
      src: pickNumber(map, ['sourcebytes', 'src_bytes']),
      dst: pickNumber(map, ['destinationbytes', 'dest_bytes']),
    };
    network.packets = {
      src: pickNumber(map, ['sourcepackets', 'src_packets']),
      dst: pickNumber(map, ['destinationpackets', 'dest_packets']),
    };
    network.flags   = {
      src: pickString(map, ['sourceflags', 'src_flags']),
      dst: pickString(map, ['destinationflags', 'dest_flags']),
    };
    network.asn     = {
      src: pickNumber(map, ['sourceasn', 'src_asn']),
      dst: pickNumber(map, ['destinationasn', 'dest_asn']),
    };
    network.flowSource = pickString(map, ['flowsource', 'flow_source', 'flowinterface']);
  }

  return network;
}

/**
 * Rohen QRadar-Record (Event oder Flow) → strukturierter Parsed-Record.
 * Alle Rohfelder bleiben unter `fields` (case-normalisiert) und `raw` erhalten.
 */
function parseQRadarRecord(rec, options = {}) {
  const type = detectRecordType(rec, options.type);
  const map  = lowerKeyMap(rec);

  const isFlow = type === 'flow';
  const startAliases = isFlow ? ['firstpackettime', 'starttime', 'first_packet_time'] : ['starttime', 'devicetime', 'firstpackettime'];
  const endAliases   = isFlow ? ['lastpackettime', 'endtime', 'last_packet_time']   : ['endtime', 'lastpackettime'];

  return {
    type,
    source: 'qradar',

    recordId: isFlow
      ? pickString(map, ['flowid', 'flow_id'])
      : pickString(map, ['qid', 'eventid', 'event_id']),

    name: isFlow
      ? pickString(map, ['application', 'applicationname'])
      : pickString(map, ['qidname', 'qid_name', 'eventname', 'event_name']),

    severity:    pickNumber(map, ['severity']),
    credibility: pickNumber(map, ['credibility']),
    relevance:   pickNumber(map, ['relevance']),
    magnitude:   pickNumber(map, ['magnitude']),
    eventCount:  pickNumber(map, ['eventcount', 'event_count']),

    category: {
      name: pickString(map, ['categoryname', 'category', 'category_name']),
      high: pickString(map, ['highlevelcategory', 'high_level_category']),
      low:  pickString(map, ['lowlevelcategory', 'low_level_category']),
    },

    logSource: {
      id:   pickString(map, ['logsourceid', 'log_source_id']),
      name: pickString(map, ['logsourcename', 'log_source_name', 'logsource']),
      type: pickString(map, ['logsourcetypename', 'log_source_type']),
    },

    protocol: {
      id:   pickString(map, ['protocolid', 'protocol_id']),
      name: pickString(map, ['protocolname', 'protocol_name']),
    },

    network: parseNetwork(map, type),

    identity: {
      user: pickString(map, ['identityusername', 'username', 'user_name', 'user']),
      host: pickString(map, ['identityhostname', 'hostname', 'host_name', 'machineidentity']),
      ip:   pickString(map, ['identityip', 'identity_ip']),
      mac:  pickString(map, ['identitymac', 'identity_mac']),
    },

    domainId: pickString(map, ['domainid', 'domain_id']),

    payload: pickString(map, ['utf8_payload', 'payload', 'sourcepayload', 'destinationpayload']),

    // Optionale Custom-Properties (DNS/URL/Prozess/Datei/Hash)
    fqdn:          pickString(map, ['identityhostname', 'dnsdomainname', 'fqdn', 'destinationhostname']),
    url:           pickString(map, ['url', 'requesturl', 'uri']),
    process:       pickString(map, ['processname', 'process', 'image']),
    parentProcess: pickString(map, ['parentprocessname', 'parentimage']),
    file:          pickString(map, ['filename', 'file', 'targetfilename']),
    hash:          pickString(map, ['filehash', 'hash', 'sha256', 'md5']),

    time: {
      start:      mapTimestamp(pick(map, startAliases)),
      end:        mapTimestamp(pick(map, endAliases)),
      deviceTime: mapTimestamp(pick(map, ['devicetime', 'device_time'])),
    },

    // ALLE Rohfelder case-normalisiert + Original für volle Nachvollziehbarkeit.
    fields: Object.fromEntries(map),
    raw: rec,
  };
}

module.exports = {
  detectRecordType,
  parseQRadarRecord,
  // intern, für gezielte Tests/Wiederverwendung exportiert
  lowerKeyMap,
  pick,
};
