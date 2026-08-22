'use strict';

const { buildInventoryLookup, enrichFlowWithInventory, enrichFlowsWithInventory } = require('../../src/correlation/flowInventoryEnrichment');
const { normalizeFlow } = require('../../src/correlation/flowNormalizer');

const NOW = '2026-06-17T12:00:00.000Z';

// Agenten-Inventar (Form wie aus Wazuh getAgentInventory aufbereitet).
const AGENTS = [
  { agentId: '009', host: 'DC01', interfaces: [
      { name: 'Loopback Pseudo-Interface 1', mac: '00:00:00:00:00:00' },
      { name: 'Ethernet', mac: 'bc:24:11:7b:45:69' }],
    addresses: [
      { iface: 'Loopback Pseudo-Interface 1', address: '127.0.0.1', proto: 'ipv4' },
      { iface: 'Ethernet', address: '10.99.99.10', proto: 'ipv4' },
      { iface: 'Ethernet', address: 'fe80::1', proto: 'ipv6' }] },
  { agentId: '011', host: 'opensourcebackup', interfaces: [{ name: 'eth0', mac: 'aa:bb:cc:dd:ee:11' }],
    addresses: [{ iface: 'eth0', address: '10.99.99.72', proto: 'ipv4' }] },
  { agentId: '001', host: 'CERBERUS', interfaces: [{ name: 'Ethernet 2', mac: '9c:6b:00:76:e6:fe' }],
    addresses: [{ iface: 'Ethernet 2', address: '192.168.241.102', proto: 'ipv4' }] },
];
const LOOKUP = buildInventoryLookup(AGENTS);

const sysmonFlow = () => normalizeFlow({
  '@timestamp': '2026-06-15T23:34:17.000Z',
  data: { win: { system: { eventID: '3' }, eventdata: {
    utcTime: '2026-06-15 23:34:16.686', image: 'C:\\Windows\\System32\\powershell.exe',
    protocol: 'tcp', initiated: 'true', sourceIp: '10.99.99.10', sourcePort: '52835',
    destinationIp: '10.99.99.72', destinationPort: '8080', user: 'NT AUTHORITY\\SYSTEM',
  } } },
}, { now: NOW });

const firewallFlow = () => normalizeFlow({
  '@timestamp': '2026-06-16T10:00:00.000Z',
  data: { srcip: '192.168.241.102', dstip: '192.168.240.1', dstport: '53', protocol: 'udp', action: 'block' },
}, { now: NOW });

describe('buildInventoryLookup', () => {
  test('mappt IPv4 -> Interface/MAC/Host; ueberspringt Loopback/Null-MAC', () => {
    expect(LOOKUP.byIp['10.99.99.10']).toMatchObject({ agentId: '009', host: 'DC01', interfaceName: 'Ethernet', mac: 'bc:24:11:7b:45:69', source: 'wazuh_api' });
    expect(LOOKUP.byIp['192.168.241.102']).toMatchObject({ host: 'CERBERUS', interfaceName: 'Ethernet 2', mac: '9c:6b:00:76:e6:fe' });
    expect(LOOKUP.byIp['127.0.0.1']).toBeUndefined();
  });
});

describe('A) DC01 Sysmon-Flow — beide Seiten aus Inventory angereichert', () => {
  const f = enrichFlowWithInventory(sysmonFlow(), LOOKUP, { now: NOW });
  test('Source + Destination MAC/Interface/Host gesetzt, Provenance wazuh_api', () => {
    expect(f.sourceMac).toBe('bc:24:11:7b:45:69');
    expect(f.sourceHostInterface).toBe('Ethernet');
    expect(f.sourceHost).toBe('DC01');
    expect(f.provenance.sourceMac).toMatchObject({ source: 'wazuh_api', fieldPath: 'syscollector.netiface.mac', confidence: 'high' });
    expect(f.provenance.sourceHostInterface).toMatchObject({ source: 'wazuh_api', fieldPath: 'syscollector.netiface.name', confidence: 'high' });
    expect(f.missingReason.sourceMac).toBeUndefined();
    expect(f.destinationMac).toBe('aa:bb:cc:dd:ee:11');
    expect(f.destinationHost).toBe('opensourcebackup');
  });
  test('sourceType + Prozess bleiben erhalten; Zone = source_provides_none', () => {
    expect(f.sourceType).toBe('sysmon_event3');
    expect(f.processImage).toMatch(/powershell\.exe$/);
    expect(f.missingReason.sourceZone).toBe('source_provides_none');
  });
});

describe('B) OPNsense Firewall-Flow — Destination nicht im Inventory', () => {
  const f = enrichFlowWithInventory(firewallFlow(), LOOKUP, { now: NOW });
  test('Source (CERBERUS) angereichert; Destination (FritzBox) not_in_inventory', () => {
    expect(f.sourceMac).toBe('9c:6b:00:76:e6:fe');
    expect(f.sourceHostInterface).toBe('Ethernet 2');
    expect(f.sourceHost).toBe('CERBERUS');
    expect(f.destinationMac).toBeNull();
    expect(f.destinationHost).toBeNull();
    expect(f.missingReason.destinationMac).toBe('not_in_inventory');
  });
  test('processImage bleibt null mit source_provides_none (Firewall liefert keinen Prozess)', () => {
    expect(f.processImage).toBeNull();
    expect(f.missingReason.processImage).toBe('source_provides_none');
  });
});

describe('C) IP nicht im Inventory -> not_in_inventory, keine Fake-Werte', () => {
  test('unbekannte Source-IP', () => {
    const flow = normalizeFlow({ data: { srcip: '8.8.8.8', dstip: '1.1.1.1' } }, { now: NOW });
    const f = enrichFlowWithInventory(flow, LOOKUP, { now: NOW });
    expect(f.sourceMac).toBeNull();
    expect(f.missingReason.sourceMac).toBe('not_in_inventory');
    expect(f.sourceHost).toBeNull();
  });
});

describe('D) Inventory nicht geladen -> inventory_not_loaded', () => {
  test('lookup null', () => {
    const f = enrichFlowWithInventory(sysmonFlow(), null, { now: NOW });
    expect(f.sourceMac).toBeNull();
    expect(f.missingReason.sourceMac).toBe('inventory_not_loaded');
  });
});

describe('E) bestehende Werte nicht ueberschreiben', () => {
  test('bereits gesetzte sourceMac bleibt erhalten', () => {
    const base = sysmonFlow();
    base.sourceMac = 'de:ad:be:ef:00:01';
    base.provenance.sourceMac = { source: 'wazuh_alert', fieldPath: 'data.smac', confidence: 'high' };
    const f = enrichFlowWithInventory(base, LOOKUP, { now: NOW });
    expect(f.sourceMac).toBe('de:ad:be:ef:00:01');
    expect(f.provenance.sourceMac.source).toBe('wazuh_alert'); // nicht ueberschrieben
  });
});

describe('CE-4.4 FQDN aus Inventory — nur echter FQDN, kein Fake', () => {
  const flowFromIp = (ip) => normalizeFlow({ data: { srcip: ip } }, { now: NOW });

  test('C) Inventory liefert echten FQDN → sourceFqdn gesetzt (vorher leer)', () => {
    const lookup = buildInventoryLookup([{ agentId: '009', host: 'DC01', fqdn: 'dc01.nexora.example',
      interfaces: [], addresses: [{ iface: 'eth0', address: '10.99.99.99', proto: 'ipv4' }] }]);
    const f = enrichFlowWithInventory(flowFromIp('10.99.99.99'), lookup, { now: NOW });
    expect(f.sourceFqdn).toBe('dc01.nexora.example');
    expect(f.sourceHost).toBe('DC01');
    expect(f.provenance.sourceFqdn.source).toBe('wazuh_api');
    expect(f.missingReason.sourceFqdn).toBeUndefined();
  });

  test('D) Inventory liefert nur Kurzname → Host gesetzt, sourceFqdn bleibt null', () => {
    const lookup = buildInventoryLookup([{ agentId: '009', host: 'DC01', fqdn: 'DC01',
      interfaces: [], addresses: [{ iface: 'eth0', address: '10.99.99.99', proto: 'ipv4' }] }]);
    const f = enrichFlowWithInventory(flowFromIp('10.99.99.99'), lookup, { now: NOW });
    expect(f.sourceHost).toBe('DC01');
    expect(f.sourceFqdn).toBeNull();
    expect(f.missingReason.sourceFqdn).toBe('field_missing');
  });

  test('E) Event-FQDN gewinnt — Inventory überschreibt vorhandenen sourceFqdn nicht', () => {
    const lookup = buildInventoryLookup([{ agentId: '009', host: 'DC01', fqdn: 'anders.nexora.example',
      interfaces: [], addresses: [{ iface: 'eth0', address: '10.99.99.99', proto: 'ipv4' }] }]);
    const base = flowFromIp('10.99.99.99');
    base.sourceFqdn = 'DC01.nexora.example';
    base.provenance.sourceFqdn = { source: 'wazuh_indexer', fieldPath: 'data.win.system.computer', confidence: 'high' };
    delete base.missingReason.sourceFqdn;
    const f = enrichFlowWithInventory(base, lookup, { now: NOW });
    expect(f.sourceFqdn).toBe('DC01.nexora.example');                       // nicht überschrieben
    expect(f.provenance.sourceFqdn.fieldPath).toBe('data.win.system.computer');
  });
});

describe('enrichFlowsWithInventory (Batch)', () => {
  test('reichert mehrere Flows an, immutabel (Input unveraendert)', () => {
    const inputs = [sysmonFlow(), firewallFlow()];
    const before = inputs[0].sourceMac;
    const out = enrichFlowsWithInventory(inputs, LOOKUP, { now: NOW });
    expect(out).toHaveLength(2);
    expect(out[0].sourceMac).toBe('bc:24:11:7b:45:69');
    expect(inputs[0].sourceMac).toBe(before); // Original nicht mutiert
  });
});
