'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-3 — Flow-Normalizer (vollständiges Network/NAT-Modell)
//
// Vereinheitlicht Netzwerk-Events verschiedener Quellen (Firewall-Syslog UND
// Sysmon Event 3 / NetworkConnect) in EIN Flow-Modell — strukturell inklusive
// FQDN/MAC/Interface/Zone, Firewall-Action/Bytes und NAT-Translation, auch wenn
// nicht jede Quelle alles liefert.
//
// Schichten der Korrelation (Wahrheit pro Feld über Provenance + missingReason):
//   CE-3 (hier) = Flow normalisieren (L3/L4 + Prozesskontext)
//   CE-4        = Host/MAC/FQDN/Interface aus Inventory/Syscollector anreichern
//   CE-5        = Destination-FQDN/Reputation/ASN aus DNS/Threat-Intel anreichern
//   Firewall/Suricata = NAT/Action/Bytes liefern
//
// Rein (keine Fetches). ADR-009: nie Werte erfinden — fehlt etwas, Wert=null +
// missingReason:
//   field_missing        Quelle KÖNNTE das Feld liefern, im Event fehlt es
//   source_provides_none Diese Quelle liefert dieses Feld grundsätzlich nicht
//   inventory_not_loaded Feld kommt aus Inventory/Host-Anreicherung (CE-4)
//   threat_intel_pending Feld kommt aus DNS/Threat-Intel-Anreicherung (CE-5)
// ─────────────────────────────────────────────────────────────────────────

const SOURCE = 'wazuh_indexer';

// Klassifizierungs-Marker (statt eines Feldpfads).
const INV = Symbol('inventory_not_loaded');   // → CE-4
const TI  = Symbol('threat_intel_pending');   // → CE-5
const FM  = Symbol('field_missing');          // Quelle könnte liefern, kein dekodierter Pfad
const NONE = null;                            // Quelle liefert dieses Feld nie

const FIELDS = [
  'timestamp',
  // Host-/Endpoint-Inventory-Kontext (Host-NIC) — kommt aus CE-4 (Wazuh-Syscollector),
  // NICHT aus dem Firewall-Log. Bewusst getrennt vom Firewall-Interface (s. u.).
  'sourceIp', 'sourcePort', 'sourceHost', 'sourceFqdn', 'sourceMac', 'sourceHostInterface', 'sourceZone',
  'destinationIp', 'destinationPort', 'destinationHost', 'destinationFqdn', 'destinationMac', 'destinationHostInterface', 'destinationZone',
  'protocol', 'transport', 'direction', 'action',
  'bytesSent', 'bytesReceived', 'packetsSent', 'packetsReceived', 'durationMs',
  'originalSourceIp', 'originalSourcePort', 'postNatSourceIp', 'postNatSourcePort',
  'originalDestinationIp', 'originalDestinationPort', 'postNatDestinationIp', 'postNatDestinationPort',
  'natType', 'natRule', 'firewallRule',
  // Firewall-/Network-Device-Kontext (Interface, auf dem die Regel matchte) —
  // kommt aus dem Firewall-Log (data.srcintf/dstintf), NICHT die Host-NIC.
  'firewallInterface', 'firewallIngressInterface', 'firewallEgressInterface',
  'processImage', 'processId', 'processGuid', 'user',
];

const NUMERIC = new Set([
  'sourcePort', 'destinationPort', 'originalSourcePort', 'postNatSourcePort',
  'originalDestinationPort', 'postNatDestinationPort',
  'bytesSent', 'bytesReceived', 'packetsSent', 'packetsReceived', 'durationMs',
]);
const LOWER = new Set(['protocol', 'transport', 'action', 'direction', 'natType']);

// Pfad-Mapping je sourceType. timestamp + direction werden gesondert behandelt.
const PATHS = {
  sysmon_event3: {
    sourceIp:        'data.win.eventdata.sourceIp',
    sourcePort:      'data.win.eventdata.sourcePort',
    sourceHost:      'data.win.eventdata.sourceHostname',
    sourceFqdn:      INV,
    sourceMac:       INV,
    sourceHostInterface: INV,
    sourceZone:      INV,
    destinationIp:   'data.win.eventdata.destinationIp',
    destinationPort: 'data.win.eventdata.destinationPort',
    destinationHost: 'data.win.eventdata.destinationHostname',
    destinationFqdn: TI,
    destinationMac:  INV,
    destinationHostInterface: INV,
    destinationZone: INV,
    protocol:        'data.win.eventdata.protocol',
    transport:       'data.win.eventdata.protocol',
    action:          NONE,   // Sysmon ist keine Firewall (geloggt = fand statt)
    bytesSent:       NONE, bytesReceived: NONE, packetsSent: NONE, packetsReceived: NONE, durationMs: NONE,
    originalSourceIp: NONE, originalSourcePort: NONE, postNatSourceIp: NONE, postNatSourcePort: NONE,
    originalDestinationIp: NONE, originalDestinationPort: NONE, postNatDestinationIp: NONE, postNatDestinationPort: NONE,
    natType: NONE, natRule: NONE, firewallRule: NONE,
    // Endpoint ist keine Firewall → kein Firewall-Interface.
    firewallInterface: NONE, firewallIngressInterface: NONE, firewallEgressInterface: NONE,
    processImage:    'data.win.eventdata.image',
    processId:       'data.win.eventdata.processId',
    processGuid:     'data.win.eventdata.processGuid',
    user:            'data.win.eventdata.user',
  },
  firewall: {
    sourceIp:        'data.srcip',
    sourcePort:      'data.srcport',
    sourceHost:      'data.srchost',
    sourceFqdn:      INV,
    sourceMac:       INV,
    sourceHostInterface: INV,   // Host-NIC kommt aus CE-4 — NICHT aus srcintf (das ist das Firewall-Interface)
    sourceZone:      'data.srczone',
    destinationIp:   'data.dstip',
    destinationPort: 'data.dstport',
    destinationHost: 'data.dsthost',
    destinationFqdn: TI,
    destinationMac:  INV,
    destinationHostInterface: INV,
    destinationZone: 'data.dstzone',
    protocol:        'data.protocol',
    transport:       'data.transport',
    action:          'data.action',
    bytesSent:       'data.bytes_out',
    bytesReceived:   'data.bytes_in',
    packetsSent:     'data.packets_out',
    packetsReceived: 'data.packets_in',
    durationMs:      FM,
    originalSourceIp:      'data.nat_srcip',
    originalSourcePort:    'data.nat_srcport',
    postNatSourceIp:       'data.post_nat_srcip',
    postNatSourcePort:     'data.post_nat_srcport',
    originalDestinationIp: 'data.nat_dstip',
    originalDestinationPort: 'data.nat_dstport',
    postNatDestinationIp:  'data.post_nat_dstip',
    postNatDestinationPort: 'data.post_nat_dstport',
    natType:         FM,
    natRule:         'data.nat_rule',
    firewallRule:    'data.rulenum',
    // Firewall-Interface = das Interface, auf dem die Regel matchte (OPNsense filterlog:
    // srcintf = Ingress, dstintf = Egress). firewallInterface spiegelt das Ingress-Interface
    // (primäres Anzeige-Feld); ingress/egress sind das gerichtete Paar.
    firewallInterface:        'data.srcintf',
    firewallIngressInterface: 'data.srcintf',
    firewallEgressInterface:  'data.dstintf',
    processImage:    NONE,
    processId:       NONE,
    processGuid:     NONE,
    user:            'data.srcuser',
  },
  // Cowrie-Honeypot (medium-interaction SSH/Telnet) — Slice 1: nur die ehrliche
  // Honeypot-Sicht. Der Honeypot sieht den Angreifer (src_ip = echte Quelle) und
  // seine EIGENE interne Post-DNAT-Adresse (dst_ip). Öffentliche Ziel-IP, NAT-Regel
  // und Firewall-Interface kann er prinzipiell NICHT sehen → source_provides_none,
  // bis OPNsense das via Stitching (Slice 3) belegt. protocol/durationMs/timestamp/
  // direction + Honeypot-Extras werden in normalizeFlow gesondert gesetzt.
  cowrie: {
    sourceIp:        'data.src_ip',
    sourcePort:      'data.src_port',
    sourceHost:      NONE,
    sourceFqdn:      TI,
    sourceMac:       INV,
    sourceHostInterface: INV,
    sourceZone:      INV,
    destinationIp:   'data.dst_ip',
    destinationPort: 'data.dst_port',
    destinationHost: NONE,
    destinationFqdn: TI,
    destinationMac:  INV,
    destinationHostInterface: INV,
    destinationZone: INV,
    protocol:        NONE,   // → in normalizeFlow auf 'tcp' (SSH/Telnet) abgeleitet
    transport:       NONE,   // ssh/telnet wird als `service`-Extra geführt, nicht als transport
    action:          NONE,
    bytesSent:       NONE, bytesReceived: NONE, packetsSent: NONE, packetsReceived: NONE,
    durationMs:      NONE,   // → in normalizeFlow aus data.duration (s→ms)
    originalSourceIp: NONE, originalSourcePort: NONE, postNatSourceIp: NONE, postNatSourcePort: NONE,
    originalDestinationIp: NONE, originalDestinationPort: NONE, postNatDestinationIp: NONE, postNatDestinationPort: NONE,
    natType: NONE, natRule: NONE, firewallRule: NONE,
    firewallInterface: NONE, firewallIngressInterface: NONE, firewallEgressInterface: NONE,
    processImage:    NONE,
    processId:       NONE,
    processGuid:     NONE,
    user:            NONE,   // Login-Versuche gehören in Slice 2 (honeypot_session), maskiert
  },
  // Suricata-eve-Flow (TAP/IDS): echte Bytes/Pakete aus data.flow.*; dest_ip (NICHT dst_ip!).
  // Keine NAT/Firewall/Prozess-Felder (Sensor, kein Firewall-Verdikt). in_iface = Capture-IF
  // (Sensor-Kontext), bewusst NICHT als Firewall-Interface gemappt.
  suricata: {
    sourceIp:        'data.src_ip',
    sourcePort:      'data.src_port',
    sourceHost:      NONE,
    sourceFqdn:      TI,
    sourceMac:       INV,
    sourceHostInterface: INV,
    sourceZone:      INV,
    destinationIp:   'data.dest_ip',
    destinationPort: 'data.dest_port',
    destinationHost: NONE,
    destinationFqdn: TI,
    destinationMac:  INV,
    destinationHostInterface: INV,
    destinationZone: INV,
    protocol:        'data.proto',
    transport:       NONE,
    action:          NONE,
    bytesSent:       'data.flow.bytes_toserver',
    bytesReceived:   'data.flow.bytes_toclient',
    packetsSent:     'data.flow.pkts_toserver',
    packetsReceived: 'data.flow.pkts_toclient',
    durationMs:      FM,   // → in normalizeFlow aus data.flow.start/end bzw. age
    originalSourceIp: NONE, originalSourcePort: NONE, postNatSourceIp: NONE, postNatSourcePort: NONE,
    originalDestinationIp: NONE, originalDestinationPort: NONE, postNatDestinationIp: NONE, postNatDestinationPort: NONE,
    natType: NONE, natRule: NONE, firewallRule: NONE,
    firewallInterface: NONE, firewallIngressInterface: NONE, firewallEgressInterface: NONE,
    processImage:    NONE,
    processId:       NONE,
    processGuid:     NONE,
    user:            NONE,
  },
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function isEmpty(v) { return v === undefined || v === null || v === ''; }

function parseSysmonUtc(s) {
  if (!s || typeof s !== 'string') return undefined;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}T${m[2]}Z`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function detectSourceType(src = {}) {
  const d = src.data || {};
  // Cowrie-Honeypot: NUR Session-Lifecycle (connect/closed) ist ein Netzwerk-Flow.
  // command/login/download = Session-Inhalt (Slice 2), kein Flow.
  const cowrieEid = d.eventid;
  // Slice 2b.4: JEDES Cowrie-Event mit echter src_ip ist eine (ggf. partielle)
  // Netzwerkbeziehung. Die real indexierten eventids sind login/command/client.version
  // (session.connect/closed erreichen den Indexer nicht). src_ip ist der Anker;
  // ohne src_ip kein Flow.
  if (typeof cowrieEid === 'string' && cowrieEid.startsWith('cowrie.') && !isEmpty(d.src_ip)) return 'cowrie';
  // Suricata-eve mit data.flow Byte-/Paket-Zählern (TAP/IDS) → echter Flow mit Bytes/Paketen.
  if (d.flow && (!isEmpty(d.flow.bytes_toserver) || !isEmpty(d.flow.bytes_toclient) || !isEmpty(d.flow.pkts_toserver))) return 'suricata';
  const eid = d.win && d.win.system && d.win.system.eventID;
  const ed = (d.win && d.win.eventdata) || {};
  if (String(eid) === '3' || !isEmpty(ed.destinationIp) || !isEmpty(ed.sourceIp)) return 'sysmon_event3';
  if (!isEmpty(d.srcip) || !isEmpty(d.dstip)) return 'firewall';
  return 'unknown';
}

function coerce(field, raw) {
  if (NUMERIC.has(field)) { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  if (LOWER.has(field)) return String(raw).toLowerCase();
  return String(raw);
}

function prov(fieldPath, collectedAt, missingReason) {
  return missingReason
    ? { source: SOURCE, fieldPath: fieldPath || null, confidence: null, collectedAt, missingReason }
    : { source: SOURCE, fieldPath, confidence: 'high', collectedAt };
}

// Ein Feld anhand seines Klassifizierers auflösen → { value, provenance }.
function resolveField(src, classifier, field, knownType, collectedAt) {
  if (classifier === INV)  return { value: null, p: prov(null, collectedAt, 'inventory_not_loaded') };
  if (classifier === TI)   return { value: null, p: prov(null, collectedAt, 'threat_intel_pending') };
  if (classifier === FM)   return { value: null, p: prov(null, collectedAt, 'field_missing') };
  if (classifier === NONE) {
    // Unbekannte Quelle: wir wissen die Form nicht → field_missing statt provides_none.
    return { value: null, p: prov(null, collectedAt, knownType ? 'source_provides_none' : 'field_missing') };
  }
  // string = Feldpfad
  const raw = getPath(src, classifier);
  if (isEmpty(raw)) return { value: null, p: prov(classifier, collectedAt, 'field_missing') };
  const value = coerce(field, raw);
  if (isEmpty(value)) return { value: null, p: prov(classifier, collectedAt, 'field_missing') };
  return { value, p: prov(classifier, collectedAt) };
}

function resolveDirection(src, sourceType, knownType, collectedAt) {
  // Suricata to_server/to_client ≠ unsere inbound/outbound-Semantik → nicht raten.
  if (sourceType === 'suricata') {
    return { value: null, p: prov('data.direction', collectedAt, 'field_missing') };
  }
  // Honeypot empfängt ausschließlich → Verbindung ist definitionsgemäß inbound.
  if (sourceType === 'cowrie') {
    return { value: 'inbound', p: prov('derived:honeypot_inbound', collectedAt) };
  }
  if (sourceType === 'sysmon_event3') {
    const init = getPath(src, 'data.win.eventdata.initiated');
    if (init === 'true' || init === true)  return { value: 'outbound', p: prov('data.win.eventdata.initiated', collectedAt) };
    if (init === 'false' || init === false) return { value: 'inbound', p: prov('data.win.eventdata.initiated', collectedAt) };
    return { value: null, p: prov('data.win.eventdata.initiated', collectedAt, 'field_missing') };
  }
  if (sourceType === 'firewall') {
    const dir = getPath(src, 'data.direction');
    if (!isEmpty(dir)) return { value: String(dir).toLowerCase(), p: prov('data.direction', collectedAt) };
    return { value: null, p: prov('data.direction', collectedAt, 'field_missing') };
  }
  return { value: null, p: prov(null, collectedAt, knownType ? 'source_provides_none' : 'field_missing') };
}

// Echter FQDN? Muss einen Punkt enthalten, kein Kurzname, kein localhost, keine reine IP.
function isRealFqdn(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || !s.includes('.')) return false;
  if (/^localhost$/i.test(s)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return false; // reine IPv4 ist kein FQDN
  return true;
}

// CE-4.4 FQDN-Quelle 1: meldender Windows-Computer (Sysmon Event 3). Bei
// source-seitigem (outbound/initiated) Flow IST der meldende Host die Quelle →
// sourceFqdn. Nur setzen, wenn der Wert ein echter FQDN ist (nie raten). Bei
// inbound/unklar → field_missing (CE-4 darf später aus Inventory nachfüllen).
function resolveSourceFqdn(src, collectedAt) {
  const initiated = getPath(src, 'data.win.eventdata.initiated');
  const computer  = getPath(src, 'data.win.system.computer');
  if ((initiated === 'true' || initiated === true) && isRealFqdn(computer)) {
    return { value: String(computer).trim(), p: prov('data.win.system.computer', collectedAt) };
  }
  return { value: null, p: prov('data.win.system.computer', collectedAt, 'field_missing') };
}

function resolveTimestamp(src, sourceType, collectedAt) {
  if (sourceType === 'suricata') {
    const t = getPath(src, 'data.timestamp');
    if (!isEmpty(t)) return { value: String(t), p: prov('data.timestamp', collectedAt) };
  }
  if (sourceType === 'cowrie') {
    const t = getPath(src, 'data.timestamp');
    if (!isEmpty(t)) return { value: String(t), p: prov('data.timestamp', collectedAt) };
    // sonst Fallback auf @timestamp (unten)
  }
  const utcIso = sourceType === 'sysmon_event3' ? parseSysmonUtc(getPath(src, 'data.win.eventdata.utcTime')) : undefined;
  if (utcIso) return { value: utcIso, p: prov('data.win.eventdata.utcTime', collectedAt) };
  if (!isEmpty(src['@timestamp'])) {
    return { value: String(src['@timestamp']), p: { source: SOURCE, fieldPath: '@timestamp', confidence: 'medium', collectedAt } };
  }
  return { value: null, p: prov(null, collectedAt, 'field_missing') };
}

/**
 * Ein Roh-Indexer-Event (_source) in ein einheitliches Flow-Objekt normalisieren.
 * @param {object} src  Das `_source` eines Indexer-Treffers
 * @param {{ now?: string }} [opts]  now = collectedAt (deterministisch in Tests)
 */
function normalizeFlow(src = {}, { now } = {}) {
  const collectedAt = now || new Date().toISOString();
  const sourceType = detectSourceType(src);
  const knownType = sourceType !== 'unknown';
  const map = PATHS[sourceType] || {};

  const flow = { sourceType, provenance: {}, missingReason: {} };

  const apply = (field, resolved) => {
    flow[field] = resolved.value;
    flow.provenance[field] = resolved.p;
    // missingReason konsistent halten: setzen wenn fehlend, sonst löschen (z. B.
    // wenn ein späterer Resolver — CE-4.4 sourceFqdn — den Platzhalter überschreibt).
    if (resolved.p.missingReason) flow.missingReason[field] = resolved.p.missingReason;
    else delete flow.missingReason[field];
  };

  apply('timestamp', resolveTimestamp(src, sourceType, collectedAt));
  apply('direction', resolveDirection(src, sourceType, knownType, collectedAt));

  for (const field of FIELDS) {
    if (field === 'timestamp' || field === 'direction') continue;
    const classifier = Object.prototype.hasOwnProperty.call(map, field) ? map[field] : (knownType ? NONE : FM);
    apply(field, resolveField(src, classifier, field, knownType, collectedAt));
  }

  // CE-4.4: Event-Computer-FQDN (Sysmon, source-seitig) hat Vorrang vor Inventory (CE-4).
  // Überschreibt den INV-Platzhalter; CE-4 füllt via setIfEmpty nur, wenn weiter leer.
  if (sourceType === 'sysmon_event3') apply('sourceFqdn', resolveSourceFqdn(src, collectedAt));

  // ── Cowrie-Honeypot (Slice 1): abgeleitete Felder + Session-Extras ──────────
  // Honeypot-Extras (service/sessionId/sensorId/connectionState/flowStart/flowEnd)
  // sind NICHT Teil des Standard-FIELDS-Satzes — sie erscheinen nur an Cowrie-Flows,
  // damit Sysmon/Firewall-Flows strukturell unverändert bleiben.
  if (sourceType === 'cowrie') {
    const d = src.data || {};
    // SSH/Telnet ist definitionsgemäß TCP → ableiten (als derived markiert, nicht erfunden).
    apply('protocol', { value: 'tcp', p: prov('derived:ssh_telnet_is_tcp', collectedAt) });

    // durationMs nur bei session.closed (Sekunden → ms; echter Wert).
    const durNum = Number(d.duration);
    if (!isEmpty(d.duration) && Number.isFinite(durNum)) {
      apply('durationMs', { value: Math.round(durNum * 1000), p: prov('data.duration', collectedAt) });
    } else {
      apply('durationMs', { value: null, p: prov('data.duration', collectedAt, 'field_missing') });
    }

    apply('service',   resolveField(src, 'data.protocol', 'service', true, collectedAt));
    apply('sessionId', resolveField(src, 'data.session', 'sessionId', true, collectedAt));
    apply('sensorId',  resolveField(src, 'data.sensor', 'sensorId', true, collectedAt));

    const tsProv = flow.provenance.timestamp;
    if (d.eventid === 'cowrie.session.connect') {
      apply('connectionState', { value: 'established', p: prov('data.eventid', collectedAt) });
      apply('flowStart', { value: flow.timestamp, p: tsProv });
      apply('flowEnd',   { value: null, p: prov('data.timestamp', collectedAt, 'field_missing') });
    } else if (d.eventid === 'cowrie.session.closed') {
      apply('connectionState', { value: 'closed', p: prov('data.eventid', collectedAt) });
      apply('flowEnd',   { value: flow.timestamp, p: tsProv });
      // flowStart kommt erst aus dem connect-Event / Korrelation (Slice 2/3).
      apply('flowStart', { value: null, p: prov('data.timestamp', collectedAt, 'field_missing') });
    }

    // Slice 2b.4: Cowrie liefert (bei login/command/client.version) KEIN vollständiges
    // 5-Tuple — Ziel-IP/Ports fehlen. Ehrlich als partiell markieren statt erfinden.
    const FIVE_TUPLE = 'source_does_not_provide_5_tuple';
    for (const field of ['destinationIp', 'destinationPort', 'sourcePort']) {
      if (flow[field] == null) {
        flow.missingReason[field] = FIVE_TUPLE;
        if (flow.provenance[field]) flow.provenance[field] = { ...flow.provenance[field], missingReason: FIVE_TUPLE };
      }
    }
    flow.flowCompleteness = (flow.destinationIp && flow.destinationPort) ? 'full' : 'partial';
  }

  // ── Suricata (S1): Flow-Zeiten/State + additive Metadaten (data.flow.* / eve) ──
  if (sourceType === 'suricata') {
    const fl = (src.data && src.data.flow) || {};
    const d = src.data || {};
    apply('flowStart', isEmpty(fl.start)
      ? { value: null, p: prov('data.flow.start', collectedAt, 'field_missing') }
      : { value: String(fl.start), p: prov('data.flow.start', collectedAt) });
    apply('flowEnd', isEmpty(fl.end)
      ? { value: null, p: prov('data.flow.end', collectedAt, 'field_missing') }
      : { value: String(fl.end), p: prov('data.flow.end', collectedAt) });
    const startMs = Date.parse(fl.start);
    const endMs = Date.parse(fl.end);
    const ageNum = Number(fl.age);
    let dur = null;
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) dur = Math.max(0, endMs - startMs);
    else if (!isEmpty(fl.age) && Number.isFinite(ageNum)) dur = Math.round(ageNum * 1000);
    apply('durationMs', dur != null
      ? { value: dur, p: prov('data.flow.start/end', collectedAt) }
      : { value: null, p: prov('data.flow.end', collectedAt, 'field_missing') });
    apply('connectionState', isEmpty(fl.state)
      ? { value: null, p: prov('data.flow.state', collectedAt, 'field_missing') }
      : { value: String(fl.state).toLowerCase(), p: prov('data.flow.state', collectedAt) });
    // Additive Metadaten — nur wenn vorhanden, nicht voraussetzen.
    if (!isEmpty(d.app_proto)) apply('appProtocol', { value: String(d.app_proto), p: prov('data.app_proto', collectedAt) });
    if (!isEmpty(d.flow_id)) apply('flowId', { value: String(d.flow_id), p: prov('data.flow_id', collectedAt) });
    if (!isEmpty(d.community_id)) apply('communityId', { value: String(d.community_id), p: prov('data.community_id', collectedAt) });
  }

  return flow;
}

module.exports = { normalizeFlow, detectSourceType, parseSysmonUtc, isRealFqdn, FIELDS, PATHS };
