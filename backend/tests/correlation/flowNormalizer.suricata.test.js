'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Suricata-Flow-Normalizer (S1) — echte Felder aus dem Wazuh-/Suricata-eve-Event.
// Struktur verifiziert am Live-Indexer: data.src_ip/dest_ip (dest!), data.proto,
// data.app_proto, data.flow.{bytes_toserver/toclient, pkts_toserver/toclient, start}.
// `end`/`age`/`state` sind oft NICHT vorhanden → ehrlich field_missing.
// Kein GeoIP/ASN/Reputation/NAT/Interface erfinden; direction NICHT aus to_server raten.
// ─────────────────────────────────────────────────────────────────────────

const { normalizeFlow, detectSourceType } = require('../../src/correlation/flowNormalizer');
const NOW = '2026-06-24T00:00:00.000Z';

const suricata = {
  '@timestamp': '2026-06-19T21:20:53.000Z',
  rule: { id: '86601', groups: ['suricata', 'ids'] },
  agent: { id: '012', name: 'ids-sensor', ip: '10.99.99.60' },
  data: {
    event_type: 'alert', app_proto: 'ssh', proto: 'TCP', direction: 'to_server',
    src_ip: '185.220.101.45', src_port: '49152', dest_ip: '10.99.99.80', dest_port: '2222',
    flow_id: '1447098499621201', in_iface: 'vtnet0', community_id: '1:abcd=',
    flow: {
      bytes_toserver: '1234', bytes_toclient: '5678', pkts_toserver: '10', pkts_toclient: '8',
      start: '2026-06-19T21:20:50.000Z', src_ip: '185.220.101.45', dest_ip: '10.99.99.80',
    },
    timestamp: '2026-06-19T21:20:53.926752+0200',
  },
};

describe('detectSourceType — Suricata', () => {
  test('Event mit data.flow Byte-/Paket-Zählern → suricata', () => {
    expect(detectSourceType(suricata)).toBe('suricata');
  });
  test('ohne data.flow-Zähler ist KEIN suricata-Flow', () => {
    expect(detectSourceType({ data: { event_type: 'alert', src_ip: '1.1.1.1' } })).not.toBe('suricata');
  });
});

describe('normalizeFlow — Suricata flow', () => {
  const f = normalizeFlow(suricata, { now: NOW });

  test('5-Tuple (dest_ip, nicht dst_ip) + protocol', () => {
    expect(f.sourceType).toBe('suricata');
    expect(f.sourceIp).toBe('185.220.101.45');
    expect(f.sourcePort).toBe(49152);
    expect(f.destinationIp).toBe('10.99.99.80');
    expect(f.destinationPort).toBe(2222);
    expect(f.protocol).toBe('tcp');
  });

  test('Bytes/Pakete aus data.flow.* (toserver=sent, toclient=received)', () => {
    expect(f.bytesSent).toBe(1234);
    expect(f.bytesReceived).toBe(5678);
    expect(f.packetsSent).toBe(10);
    expect(f.packetsReceived).toBe(8);
  });

  test('flowStart aus data.flow.start; flowEnd/duration/state fehlen ehrlich', () => {
    expect(f.flowStart).toBe('2026-06-19T21:20:50.000Z');
    expect(f.flowEnd).toBeNull();
    expect(f.missingReason.flowEnd).toBe('field_missing');
    expect(f.durationMs).toBeNull();
    expect(f.missingReason.durationMs).toBe('field_missing');
    expect(f.connectionState).toBeNull();
  });

  test('additive Felder nur wenn vorhanden: appProtocol/flowId/communityId', () => {
    expect(f.appProtocol).toBe('ssh');
    expect(f.flowId).toBe('1447098499621201');
    expect(f.communityId).toBe('1:abcd=');
  });

  test('direction NICHT aus to_server geraten (bleibt offen)', () => {
    expect(f.direction).toBeNull();
  });

  test('nichts erfunden: NAT/Firewall/Prozess → source_provides_none; MAC/Zone → CE-4; FQDN → CE-5', () => {
    for (const field of ['natType', 'firewallRule', 'firewallInterface', 'postNatSourceIp', 'action', 'processImage']) {
      expect(f[field]).toBeNull();
      expect(f.missingReason[field]).toBe('source_provides_none');
    }
    expect(f.missingReason.sourceMac).toBe('inventory_not_loaded');
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
  });
});

describe('normalizeFlow — Suricata mit flow.end + state', () => {
  const closed = {
    ...suricata,
    data: { ...suricata.data, flow: { ...suricata.data.flow, end: '2026-06-19T21:20:53.000Z', state: 'established' } },
  };
  const f = normalizeFlow(closed, { now: NOW });

  test('durationMs aus start/end; connectionState aus data.flow.state', () => {
    expect(f.durationMs).toBe(3000); // 21:20:53 − 21:20:50
    expect(f.flowEnd).toBe('2026-06-19T21:20:53.000Z');
    expect(f.connectionState).toBe('established');
  });
});
