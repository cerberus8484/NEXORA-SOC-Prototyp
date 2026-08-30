'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — Nexora Suricata Flow Reader (getrennter suricata-flows-* Index).
// Rohes EVE-Schema: Felder TOP-LEVEL (kein data.*-Wrapper), wie der eigene
// Sensor-Filebeat sie schreibt. Tests mit echten, anonymisierten EVE-Flows
// (generische Beispiel-IPs). Reiner Adapter — kein Indexer/Filebeat/Wazuh hier.
//
// Vertrag:
//  - nur event_type === 'flow' (sonst null)
//  - PFLICHT-Filter Asset-/Honeypot-Scope: src ODER dest muss Asset sein (sonst null);
//    assetIps fehlt/leer → Fehler (fail-fast)
//  - nur echte Felder; nie NAT/Host/Prozess/Bytes erfinden (fehlt → null + missingReason)
// ─────────────────────────────────────────────────────────────────────────

const { readSuricataFlow, readSuricataFlows } = require('../../src/correlation/suricataFlowReader');

const HP = '10.99.99.80';        // Honeypot (Asset)
const SENSOR = '10.99.99.60';
const NOW = '2026-06-24T00:00:00.000Z';
const ASSETS = [HP];

// Echter, anonymisierter EVE-Flow (roh, top-level), dest = Honeypot.
const flowDoc = () => ({
  '@timestamp': '2026-06-24T16:40:11.500Z',
  timestamp: '2026-06-24T16:40:11.378511+0000',
  event_type: 'flow',
  flow_id: 1552070227559468,
  in_iface: 'eth3',
  src_ip: SENSOR, src_port: 37118,
  dest_ip: HP, dest_port: 2222,
  proto: 'TCP', app_proto: 'ssh',
  community_id: '1:abc=',
  flow: {
    pkts_toserver: 5, pkts_toclient: 4, bytes_toserver: 327, bytes_toclient: 280,
    start: '2026-06-24T16:40:10.000Z', end: '2026-06-24T16:40:13.000Z', state: 'established',
  },
  pipeline_source: 'suricata-flows',
});

describe('readSuricataFlow — Gates', () => {
  test('nicht-flow event_type → null (stats/alert/ssh)', () => {
    for (const et of ['stats', 'alert', 'ssh', 'dns', undefined]) {
      expect(readSuricataFlow({ ...flowDoc(), event_type: et }, { assetIps: ASSETS, now: NOW })).toBeNull();
    }
  });

  test('assetIps fehlt/leer → Fehler (Pflichtfilter)', () => {
    expect(() => readSuricataFlow(flowDoc(), { now: NOW })).toThrow(/assetIps/i);
    expect(() => readSuricataFlow(flowDoc(), { assetIps: [], now: NOW })).toThrow(/assetIps/i);
  });

  test('null/leeres Doc → null', () => {
    expect(readSuricataFlow(null, { assetIps: ASSETS, now: NOW })).toBeNull();
    expect(readSuricataFlow({}, { assetIps: ASSETS, now: NOW })).toBeNull();
  });
});

describe('readSuricataFlow — Asset-Scope (Pflicht)', () => {
  test('dest = Asset → behalten, matched=destination', () => {
    const f = readSuricataFlow(flowDoc(), { assetIps: ASSETS, now: NOW });
    expect(f).not.toBeNull();
    expect(f.assetScope.matched).toBe('destination');
    expect(f.assetScope.assets).toEqual([HP]);
  });

  test('src = Asset → behalten, matched=source', () => {
    const d = { ...flowDoc(), src_ip: HP, dest_ip: '203.0.113.45' };
    const f = readSuricataFlow(d, { assetIps: ASSETS, now: NOW });
    expect(f.assetScope.matched).toBe('source');
  });

  test('src UND dest Asset → matched=both', () => {
    const d = { ...flowDoc(), src_ip: HP, dest_ip: HP };
    expect(readSuricataFlow(d, { assetIps: ASSETS, now: NOW }).assetScope.matched).toBe('both');
  });

  test('weder src noch dest Asset → null (out of scope)', () => {
    const d = { ...flowDoc(), src_ip: '203.0.113.45', dest_ip: '198.51.100.7' };
    expect(readSuricataFlow(d, { assetIps: ASSETS, now: NOW })).toBeNull();
  });
});

describe('readSuricataFlow — echte Felder', () => {
  const f = readSuricataFlow(flowDoc(), { assetIps: ASSETS, now: NOW });

  test('5-Tuple + protocol lowercased', () => {
    expect(f.sourceIp).toBe(SENSOR);
    expect(f.sourcePort).toBe(37118);
    expect(f.destinationIp).toBe(HP);
    expect(f.destinationPort).toBe(2222);
    expect(f.protocol).toBe('tcp');
  });

  test('Bytes/Pakete roh (toServer/toClient), als Zahl', () => {
    expect(f.bytesToServer).toBe(327);
    expect(f.bytesToClient).toBe(280);
    expect(f.pktsToServer).toBe(5);
    expect(f.pktsToClient).toBe(4);
  });

  test('Flow-Zeiten: start/end + durationMs + state', () => {
    expect(f.flowStart).toBe('2026-06-24T16:40:10.000Z');
    expect(f.flowEnd).toBe('2026-06-24T16:40:13.000Z');
    expect(f.durationMs).toBe(3000);
    expect(f.connectionState).toBe('established');
  });

  test('additive Felder nur wenn vorhanden', () => {
    expect(f.appProtocol).toBe('ssh');
    expect(f.flowId).toBe('1552070227559468');
    expect(f.communityId).toBe('1:abc=');
    expect(f.inIface).toBe('eth3');
  });

  test('timestamp aus data.timestamp; eventType=flow; source=suricata_flow_index', () => {
    expect(f.timestamp).toBe('2026-06-24T16:40:11.378511+0000');
    expect(f.eventType).toBe('flow');
    expect(f.source).toBe('suricata_flow_index');
  });
});

describe('readSuricataFlow — nichts erfinden (ADR-009)', () => {
  test('NAT/Firewall/Host/Prozess werden NICHT erfunden (notProvided dokumentiert)', () => {
    const f = readSuricataFlow(flowDoc(), { assetIps: ASSETS, now: NOW });
    for (const cat of ['nat', 'firewall_verdict', 'host_inventory', 'process', 'dns_reputation']) {
      expect(f.notProvided).toContain(cat);
    }
    // keine erfundenen Felder
    expect(f.natType).toBeUndefined();
    expect(f.processImage).toBeUndefined();
    expect(f.firewallRule).toBeUndefined();
  });

  test('fehlende Bytes/Flow-Zeiten → null + missingReason field_missing', () => {
    const d = flowDoc();
    delete d.flow.bytes_toserver;
    delete d.flow.end;
    delete d.flow.state;
    const f = readSuricataFlow(d, { assetIps: ASSETS, now: NOW });
    expect(f.bytesToServer).toBeNull();
    expect(f.missingReason.bytesToServer).toBe('field_missing');
    expect(f.flowEnd).toBeNull();
    expect(f.missingReason.flowEnd).toBe('field_missing');
    expect(f.durationMs).toBeNull();          // ohne end UND age nicht berechenbar
    expect(f.connectionState).toBeNull();
  });

  test('durationMs aus flow.age wenn start/end fehlen', () => {
    const d = flowDoc();
    delete d.flow.start; delete d.flow.end;
    d.flow.age = 4;
    const f = readSuricataFlow(d, { assetIps: ASSETS, now: NOW });
    expect(f.durationMs).toBe(4000);
  });

  test('in_iface ist Sensor-Kontext, NICHT firewallInterface', () => {
    const f = readSuricataFlow(flowDoc(), { assetIps: ASSETS, now: NOW });
    expect(f.inIface).toBe('eth3');
    expect(f.firewallInterface).toBeUndefined();
  });
});

describe('readSuricataFlows — Batch', () => {
  test('filtert non-flow + out-of-scope, behält nur Asset-Flows', () => {
    const docs = [
      flowDoc(),                                                   // in scope
      { ...flowDoc(), event_type: 'stats' },                       // kein flow
      { ...flowDoc(), src_ip: '203.0.113.1', dest_ip: '203.0.113.2' }, // out of scope
      { ...flowDoc(), src_ip: HP, dest_ip: '198.51.100.9' },       // in scope (src)
    ];
    const out = readSuricataFlows(docs, { assetIps: ASSETS, now: NOW });
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.eventType === 'flow')).toBe(true);
  });

  test('assetIps fehlt → Fehler (Pflichtfilter, auch im Batch)', () => {
    expect(() => readSuricataFlows([flowDoc()], { now: NOW })).toThrow(/assetIps/i);
  });
});
