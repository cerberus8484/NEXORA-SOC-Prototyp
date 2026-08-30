'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 1 — Cowrie-Honeypot → network_flow (Mapping-Vertrag)
//
// Grenzen (bewusst eng gehalten):
//  - Nur echte Felder: 5-Tuple, protocol, flowStart/flowEnd, durationMs,
//    connectionState, direction=inbound, sessionId, sensorId, service.
//  - Honeypot-Ziel-IP = ehrliche Post-DNAT-Sicht (interne HP-IP).
//  - preNat*/öffentliche Ziel-IP/NAT-Regel/Interface bleiben null
//    (source_provides_none) — kommt erst aus OPNsense/Stitching (Slice 3).
//  - KEINE Geo/ASN/Reputation/NAT-Werte erfinden. KEINE Credentials (→ Slice 2).
// ─────────────────────────────────────────────────────────────────────────

const { normalizeFlow, detectSourceType } = require('../../src/correlation/flowNormalizer');

const NOW = '2026-06-24T00:00:00.000Z';

// Wazuh-gewrapptes Cowrie-Event (Honeypot-Agent → Indexer; Felder unter data.*)
const cowrieConnect = {
  '@timestamp': '2026-06-24T08:15:30.000Z',
  rule: { id: '100200', level: 5, groups: ['cowrie', 'honeypot'] },
  agent: { id: '013', name: 'honeypot' },
  data: {
    eventid: 'cowrie.session.connect',
    src_ip: '185.220.101.45', src_port: '49152',
    dst_ip: '10.99.99.80', dst_port: '2222',
    protocol: 'ssh',
    session: 'a1b2c3d4e5f6',
    sensor: 'nexora-honeypot',
    timestamp: '2026-06-24T08:15:30.123456Z',
  },
};

// cowrie.session.closed liefert real nur duration/session/sensor (+ ggf. src_ip),
// KEIN dst/Port — das ist die ehrliche Einzelevent-Sicht.
const cowrieClosed = {
  '@timestamp': '2026-06-24T08:20:00.000Z',
  rule: { id: '100201', level: 5, groups: ['cowrie', 'honeypot'] },
  agent: { id: '013', name: 'honeypot' },
  data: {
    eventid: 'cowrie.session.closed',
    src_ip: '185.220.101.45',
    session: 'a1b2c3d4e5f6',
    sensor: 'nexora-honeypot',
    duration: '270.5',
    protocol: 'ssh',
    timestamp: '2026-06-24T08:20:00.500000Z',
  },
};

describe('detectSourceType — Cowrie', () => {
  test('session.connect / session.closed → cowrie', () => {
    expect(detectSourceType(cowrieConnect)).toBe('cowrie');
    expect(detectSourceType(cowrieClosed)).toBe('cowrie');
  });
  test('Cowrie-Event mit src_ip → cowrie (auch login/command); ohne src_ip → unknown', () => {
    expect(detectSourceType({ data: { eventid: 'cowrie.login.success', src_ip: '91.92.40.10', session: 'x' } })).toBe('cowrie');
    expect(detectSourceType({ data: { eventid: 'cowrie.command.input', src_ip: '91.92.40.10', input: 'id', session: 'x' } })).toBe('cowrie');
    expect(detectSourceType({ data: { eventid: 'cowrie.command.input', input: 'id', session: 'x' } })).toBe('unknown'); // kein src_ip
  });
});

describe('normalizeFlow — Cowrie session.connect', () => {
  const f = normalizeFlow(cowrieConnect, { now: NOW });

  test('5-Tuple (ehrliche Post-DNAT-Sicht) gemappt', () => {
    expect(f.sourceType).toBe('cowrie');
    expect(f.sourceIp).toBe('185.220.101.45');
    expect(f.sourcePort).toBe(49152);
    expect(f.destinationIp).toBe('10.99.99.80');   // interne HP-IP nach DNAT
    expect(f.destinationPort).toBe(2222);
    expect(f.flowCompleteness).toBe('full');      // connect liefert volles 5-Tuple
  });

  test('protocol = tcp (SSH/Telnet definitionsgemäß TCP, als derived markiert)', () => {
    expect(f.protocol).toBe('tcp');
    expect(f.provenance.protocol.fieldPath).toMatch(/^derived:/);
    expect(f.provenance.protocol.confidence).toBe('high');
  });

  test('service = ssh; direction = inbound (derived)', () => {
    expect(f.service).toBe('ssh');
    expect(f.direction).toBe('inbound');
    expect(f.provenance.direction.fieldPath).toMatch(/^derived:/);
  });

  test('Session-/Sensor-Metadaten + Zeit', () => {
    expect(f.sessionId).toBe('a1b2c3d4e5f6');
    expect(f.sensorId).toBe('nexora-honeypot');
    expect(f.timestamp).toBe('2026-06-24T08:15:30.123456Z');
    expect(f.connectionState).toBe('established');
  });

  test('flowStart = connect-Zeit; flowEnd/duration noch offen (field_missing)', () => {
    expect(f.flowStart).toBe('2026-06-24T08:15:30.123456Z');
    expect(f.flowEnd).toBeNull();
    expect(f.missingReason.flowEnd).toBe('field_missing');
    expect(f.durationMs).toBeNull();
    expect(f.missingReason.durationMs).toBe('field_missing');
  });

  test('NAT / öffentliche Sicht / Firewall NICHT erfunden → source_provides_none', () => {
    for (const field of [
      'originalSourceIp', 'postNatSourceIp', 'originalDestinationIp', 'postNatDestinationIp',
      'natType', 'natRule', 'firewallRule', 'firewallInterface',
      'bytesSent', 'bytesReceived', 'packetsSent', 'packetsReceived',
      'processImage', 'action',
    ]) {
      expect(f[field]).toBeNull();
      expect(f.missingReason[field]).toBe('source_provides_none');
    }
  });

  test('MAC/Zone → inventory_not_loaded (CE-4); FQDN → threat_intel_pending (CE-5)', () => {
    expect(f.missingReason.sourceMac).toBe('inventory_not_loaded');
    expect(f.missingReason.sourceZone).toBe('inventory_not_loaded');
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
  });

  test('KEINE Credentials im Flow (gehören erst in Slice 2)', () => {
    expect(f.username).toBeUndefined();
    expect(f.password).toBeUndefined();
    expect(f.passwordAttempted).toBeUndefined();
  });
});

describe('normalizeFlow — Cowrie session.closed', () => {
  const f = normalizeFlow(cowrieClosed, { now: NOW });

  test('flowEnd + durationMs (Sekunden→ms, echter Wert) gesetzt', () => {
    expect(f.connectionState).toBe('closed');
    expect(f.flowEnd).toBe('2026-06-24T08:20:00.500000Z');
    expect(f.durationMs).toBe(270500);
    expect(f.provenance.durationMs.fieldPath).toBe('data.duration');
  });

  test('flowStart offen (nur aus connect/Korrelation) → field_missing', () => {
    expect(f.flowStart).toBeNull();
    expect(f.missingReason.flowStart).toBe('field_missing');
  });

  test('Closed-Event ohne dst → kein 5-Tuple erfunden, partial markiert', () => {
    expect(f.sourceIp).toBe('185.220.101.45');
    expect(f.sourcePort).toBeNull();
    expect(f.missingReason.sourcePort).toBe('source_does_not_provide_5_tuple');
    expect(f.destinationIp).toBeNull();
    expect(f.missingReason.destinationIp).toBe('source_does_not_provide_5_tuple');
    expect(f.flowCompleteness).toBe('partial');
  });

  test('sessionId/sensorId erhalten (für Stitching in Slice 2/3)', () => {
    expect(f.sessionId).toBe('a1b2c3d4e5f6');
    expect(f.sensorId).toBe('nexora-honeypot');
  });
});

// Slice 2b.4 — Live-Datenmuster: NUR login/command/client.version mit src_ip,
// KEIN connect/closed, KEIN dst_ip/dst_port. Diese erzeugen eine session-derived
// PARTIELLE Netzwerkbeziehung — kein 5-Tuple erfinden.
describe('normalizeFlow — Cowrie session-derived (login/command, kein connect/closed)', () => {
  const loginEvent = {
    '@timestamp': '2026-06-24T08:15:33.000Z',
    rule: { id: '100210', groups: ['cowrie'] }, agent: { id: '014', ip: '10.99.97.1' },
    data: { eventid: 'cowrie.login.success', src_ip: '91.92.40.10', username: 'administrator', protocol: 'ssh', session: 'abc', sensor: 'ubuntu', timestamp: '2026-06-24T08:15:33.000Z' },
  };
  const f = normalizeFlow(loginEvent, { now: NOW });

  test('login.success mit src_ip wird als Cowrie-Flow erkannt (echte Gegenstelle, NICHT agent.ip)', () => {
    expect(f.sourceType).toBe('cowrie');
    expect(f.sourceIp).toBe('91.92.40.10');
    expect(f.sourceIp).not.toBe('10.99.97.1'); // agent.ip = Tunnel/Sensor, NIE Quelle
    expect(f.service).toBe('ssh');
    expect(f.direction).toBe('inbound');
    expect(f.sessionId).toBe('abc');
    expect(f.sensorId).toBe('ubuntu');
  });

  test('kein 5-Tuple erfunden: Ziel/Ports null + source_does_not_provide_5_tuple, flow partial', () => {
    expect(f.destinationIp).toBeNull();
    expect(f.destinationPort).toBeNull();
    expect(f.missingReason.destinationIp).toBe('source_does_not_provide_5_tuple');
    expect(f.missingReason.destinationPort).toBe('source_does_not_provide_5_tuple');
    expect(f.flowCompleteness).toBe('partial');
  });

  test('command.input mit src_ip ist ebenfalls ein partieller Cowrie-Flow-Anker', () => {
    const c = normalizeFlow({ data: { eventid: 'cowrie.command.input', src_ip: '91.92.40.10', input: 'id', session: 'abc', protocol: 'ssh', timestamp: '2026-06-24T08:15:40.000Z' } }, { now: NOW });
    expect(c.sourceType).toBe('cowrie');
    expect(c.sourceIp).toBe('91.92.40.10');
    expect(c.flowCompleteness).toBe('partial');
  });

  test('cowrie-Event OHNE src_ip ist KEIN Flow', () => {
    const u = normalizeFlow({ data: { eventid: 'cowrie.session.closed', session: 'abc', duration: '5' } }, { now: NOW });
    expect(u.sourceType).not.toBe('cowrie');
  });
});
