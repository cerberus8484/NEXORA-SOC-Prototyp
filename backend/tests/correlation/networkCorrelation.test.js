'use strict';

const { buildNetworkCorrelation } = require('../../src/correlation/networkCorrelation');
const { buildInventoryLookup } = require('../../src/correlation/flowInventoryEnrichment');

const NOW = '2026-06-17T00:00:00.000Z';

// Inventar wie aus dem Wazuh-Cache: DC01, opensourcebackup, CERBERUS.
const INVENTORY = buildInventoryLookup([
  { agentId: '009', host: 'DC01', interfaces: [{ name: 'Ethernet', mac: 'bc:24:11:7b:45:69' }],
    addresses: [{ iface: 'Ethernet', address: '10.99.99.10', proto: 'ipv4' }] },
  { agentId: '011', host: 'opensourcebackup', interfaces: [{ name: 'eth0', mac: 'aa:bb:cc:dd:ee:11' }],
    addresses: [{ iface: 'eth0', address: '10.99.99.72', proto: 'ipv4' }] },
  { agentId: '001', host: 'CERBERUS', interfaces: [{ name: 'Ethernet 2', mac: '9c:6b:00:76:e6:fe' }],
    addresses: [{ iface: 'Ethernet 2', address: '192.168.241.102', proto: 'ipv4' }] },
]);

const sysmonSrc = (over = {}) => ({
  '@timestamp': '2026-06-15T23:34:17.000Z',
  rule: { id: '100951', level: 3 }, agent: { id: '009', name: 'DC01' },
  data: { win: {
    system: { eventID: '3' },
    eventdata: {
      utcTime: '2026-06-15 23:34:16.686',
      image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      processId: '1720', processGuid: '{guid-1}', user: 'NT AUTHORITY\\SYSTEM',
      protocol: 'tcp', sourceIp: '10.99.99.10', sourcePort: '52835',
      destinationIp: '10.99.99.72', destinationPort: '8080',
      ...over,
    },
  } },
});

const firewallSrc = {
  '@timestamp': '2026-06-16T10:00:00.000Z',
  rule: { id: '87702', level: 10 },
  data: { srcip: '192.168.240.109', srcport: '51000', dstip: '8.8.8.8', dstport: '53', protocol: 'UDP', action: 'block' },
};

describe('CE-3 buildNetworkCorrelation — A) Sysmon Event 3', () => {
  const n = buildNetworkCorrelation([sysmonSrc()], { now: NOW });
  test('landet in flows mit sourceType sysmon_event3 + Prozess-/Ziel-Daten', () => {
    expect(n.flows).toHaveLength(1);
    const f = n.flows[0];
    expect(f.sourceType).toBe('sysmon_event3');
    expect(f.processImage).toMatch(/powershell\.exe$/);
    expect(f.processGuid).toBe('{guid-1}');
    expect(f.destinationIp).toBe('10.99.99.72');
    expect(f.destinationPort).toBe(8080);
    expect(f.provenance.destinationIp.fieldPath).toBe('data.win.eventdata.destinationIp');
  });
});

describe('CE-3 buildNetworkCorrelation — B) Firewall', () => {
  const n = buildNetworkCorrelation([firewallSrc], { now: NOW });
  test('gleiches Flow-Modell, sourceType firewall, Prozessfelder null + source_provides_none', () => {
    const f = n.flows[0];
    expect(f.sourceType).toBe('firewall');
    expect(f.sourceIp).toBe('192.168.240.109');
    expect(f.destinationIp).toBe('8.8.8.8');
    expect(f.processImage).toBeNull();
    expect(f.processGuid).toBeNull();
    expect(f.provenance.processImage.missingReason).toBe('source_provides_none');
    expect(n.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'processImage', missingReason: 'source_provides_none' }),
    ]));
  });
});

describe('CE-3 buildNetworkCorrelation — C) leer/unknown', () => {
  test('leeres Array → keine Flows, keine Exception', () => {
    const n = buildNetworkCorrelation([], { now: NOW });
    expect(n.flows).toEqual([]);
    expect(n.topConversations).toEqual([]);
    expect(n.gaps).toEqual([]);
  });
  test('reines Host-/unknown-Event (keine src/dst-IP) wird als Nicht-Flow herausgefiltert', () => {
    // Verhindert, dass z. B. WMI-/FileCreate-Events den Network-Tab mit leeren Zeilen vermüllen.
    const n = buildNetworkCorrelation([{ data: {} }], { now: NOW });
    expect(n.flows).toEqual([]);
    expect(n.topConversations).toEqual([]);
  });
});

describe('CE-3 buildNetworkCorrelation — D) gemischte Quellen', () => {
  const n = buildNetworkCorrelation([sysmonSrc(), firewallSrc], { now: NOW });
  test('beide Quellen im selben Modell, nach timestamp absteigend sortiert', () => {
    expect(n.flows).toHaveLength(2);
    const types = n.flows.map((f) => f.sourceType);
    expect(types).toEqual(expect.arrayContaining(['sysmon_event3', 'firewall']));
    // Firewall (2026-06-16) ist neuer als Sysmon (2026-06-15) → zuerst.
    expect(n.flows[0].sourceType).toBe('firewall');
    expect(n.flows[1].sourceType).toBe('sysmon_event3');
  });
  test('topConversations + Summaries aus den Flows abgeleitet', () => {
    expect(n.topConversations.length).toBe(2);
    expect(n.destinationSummary.distinct).toBe(2);
    expect(n.sourceSummary.top.map((x) => x.value)).toEqual(
      expect.arrayContaining(['10.99.99.10', '192.168.240.109']),
    );
  });
});

describe('CE-4.3 buildNetworkCorrelation — E) mit inventoryLookup', () => {
  // Firewall-Flow mit srcintf=LAN (Firewall-Interface) + Host CERBERUS aus Inventar.
  const fwSrc = {
    '@timestamp': '2026-06-16T10:00:00.000Z',
    rule: { id: '87702', level: 10 },
    data: { srcip: '192.168.241.102', srcport: '51000', dstip: '192.168.240.1', dstport: '53',
      protocol: 'UDP', action: 'block', direction: 'outbound', srcintf: 'LAN', rulenum: '7' },
  };
  const n = buildNetworkCorrelation([sysmonSrc(), fwSrc], { now: NOW, inventoryLookup: INVENTORY });
  const byType = (t) => n.flows.find((f) => f.sourceType === t);

  test('DC01 Sysmon-Flow: Source + Destination aus Inventory angereichert', () => {
    const f = byType('sysmon_event3');
    expect(f.sourceMac).toBe('bc:24:11:7b:45:69');
    expect(f.sourceHostInterface).toBe('Ethernet');
    expect(f.sourceHost).toBe('DC01');
    expect(f.destinationMac).toBe('aa:bb:cc:dd:ee:11');
    expect(f.destinationHostInterface).toBe('eth0');
    expect(f.destinationHost).toBe('opensourcebackup');
    expect(f.provenance.sourceMac.source).toBe('wazuh_api');
  });

  test('Firewall-Flow: CERBERUS angereichert, firewallInterface NICHT überschrieben', () => {
    const f = byType('firewall');
    expect(f.sourceMac).toBe('9c:6b:00:76:e6:fe');
    expect(f.sourceHostInterface).toBe('Ethernet 2');   // Host-NIC aus Inventar
    expect(f.sourceHost).toBe('CERBERUS');
    expect(f.firewallInterface).toBe('LAN');             // Firewall-Interface bleibt LAN (CE-3)
    expect(f.provenance.firewallInterface.fieldPath).toBe('data.srcintf');
    // Destination 192.168.240.1 (FritzBox) ist in keinem Agent → keine Fake-Werte.
    expect(f.destinationMac).toBeNull();
    expect(f.destinationHost).toBeNull();
    expect(f.missingReason.destinationMac).toBe('not_in_inventory');
  });
});

describe('CE-4.4.1 buildNetworkCorrelation — Event-Computer-FQDN end-to-end', () => {
  // Wie die Indexer-Projektion es nach CE-4.4.1 liefert: win.system.computer + initiated.
  const src = {
    '@timestamp': '2026-06-15T23:34:17.000Z',
    data: { win: {
      system: { eventID: '3', computer: 'DC01.nexora.example' },
      eventdata: {
        initiated: 'true', protocol: 'tcp', image: 'C:\\Windows\\System32\\powershell.exe',
        sourceIp: '10.99.99.10', sourcePort: '52835', destinationIp: '10.99.99.72', destinationPort: '8080',
      },
    } },
  };
  const n = buildNetworkCorrelation([src], { now: NOW });
  test('sourceFqdn aus data.win.system.computer; destinationFqdn bleibt TI-pending; kein Fake', () => {
    const f = n.flows[0];
    expect(f.sourceType).toBe('sysmon_event3');
    expect(f.sourceFqdn).toBe('DC01.nexora.example');
    expect(f.provenance.sourceFqdn.fieldPath).toBe('data.win.system.computer');
    expect(f.missingReason.sourceFqdn).toBeUndefined();
    expect(f.destinationFqdn).toBeNull();
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
    expect(f.processImage).toMatch(/powershell\.exe$/);
  });
});

describe('CE-4.3 buildNetworkCorrelation — F) ohne inventoryLookup unverändert', () => {
  test('kein Lookup → MAC/Host bleiben inventory_not_loaded, keine Exception', () => {
    const n = buildNetworkCorrelation([sysmonSrc()], { now: NOW });
    const f = n.flows[0];
    expect(f.sourceMac).toBeNull();
    expect(f.sourceHost).toBeNull();
    expect(f.missingReason.sourceMac).toBe('inventory_not_loaded');
    expect(f.missingReason.sourceHostInterface).toBe('inventory_not_loaded');
  });
});
