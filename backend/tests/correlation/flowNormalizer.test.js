'use strict';

const { normalizeFlow, detectSourceType, parseSysmonUtc } = require('../../src/correlation/flowNormalizer');

const NOW = '2026-06-17T00:00:00.000Z';

const sysmonHit = {
  '@timestamp': '2026-06-15T23:34:17.000Z',
  rule: { id: '100951', level: 3 }, agent: { id: '009', name: 'DC01' },
  data: { win: {
    system: { eventID: '3' },
    eventdata: {
      utcTime: '2026-06-15 23:34:16.686',
      image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      processId: '1720', processGuid: '{guid-1}', user: 'NT AUTHORITY\\SYSTEM',
      protocol: 'tcp', initiated: 'true',
      sourceIp: '10.99.99.10', sourcePort: '52835', sourceHostname: 'DC01.nexora.example',
      destinationIp: '10.99.99.72', destinationPort: '8080',
    },
  } },
};

const firewallHit = {
  '@timestamp': '2026-06-16T10:00:00.000Z',
  rule: { id: '87702', level: 10 },
  data: {
    srcip: '192.168.240.109', srcport: '51000', dstip: '8.8.8.8', dstport: '53',
    protocol: 'UDP', action: 'block', direction: 'outbound', srcintf: 'igb0',
    rulenum: '42', bytes_out: '120', bytes_in: '0',
  },
};

describe('detectSourceType', () => {
  test('Sysmon Event 3 / Firewall / unknown', () => {
    expect(detectSourceType(sysmonHit)).toBe('sysmon_event3');
    expect(detectSourceType(firewallHit)).toBe('firewall');
    expect(detectSourceType({ data: {} })).toBe('unknown');
  });
});

describe('parseSysmonUtc', () => {
  test('UTC-String → ISO; ungültig → undefined', () => {
    expect(parseSysmonUtc('2026-06-15 23:34:16.686')).toBe('2026-06-15T23:34:16.686Z');
    expect(parseSysmonUtc('x')).toBeUndefined();
  });
});

describe('normalizeFlow — Sysmon Event 3', () => {
  const f = normalizeFlow(sysmonHit, { now: NOW });

  test('L3/L4 + Prozess + Host/Direction gemappt', () => {
    expect(f.sourceType).toBe('sysmon_event3');
    expect(f.sourceIp).toBe('10.99.99.10');
    expect(f.sourcePort).toBe(52835);
    expect(f.sourceHost).toBe('DC01.nexora.example');
    expect(f.destinationIp).toBe('10.99.99.72');
    expect(f.destinationPort).toBe(8080);
    expect(f.protocol).toBe('tcp');
    expect(f.direction).toBe('outbound');         // aus initiated=true
    expect(f.processImage).toMatch(/powershell\.exe$/);
    expect(f.processGuid).toBe('{guid-1}');
    expect(f.user).toBe('NT AUTHORITY\\SYSTEM');
    expect(f.timestamp).toBe('2026-06-15T23:34:16.686Z');
  });

  test('NAT/Action/Bytes/Firewall → source_provides_none (Sysmon ist keine Firewall)', () => {
    for (const field of ['action', 'bytesSent', 'postNatSourceIp', 'postNatDestinationIp', 'natType', 'firewallRule']) {
      expect(f[field]).toBeNull();
      expect(f.missingReason[field]).toBe('source_provides_none');
    }
  });

  test('MAC/HostInterface/Zone → inventory_not_loaded (kommt aus CE-4)', () => {
    for (const field of ['sourceMac', 'sourceHostInterface', 'destinationHostInterface', 'sourceZone', 'destinationMac']) {
      expect(f[field]).toBeNull();
      expect(f.missingReason[field]).toBe('inventory_not_loaded');
    }
  });

  test('Firewall-Interface → source_provides_none (Endpoint ist keine Firewall)', () => {
    for (const field of ['firewallInterface', 'firewallIngressInterface', 'firewallEgressInterface']) {
      expect(f[field]).toBeNull();
      expect(f.missingReason[field]).toBe('source_provides_none');
    }
  });

  test('destinationFqdn → threat_intel_pending (kommt aus CE-5)', () => {
    expect(f.destinationFqdn).toBeNull();
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
  });
});

describe('normalizeFlow — Firewall', () => {
  const f = normalizeFlow(firewallHit, { now: NOW });

  test('Firewall-Felder gemappt — srcintf → firewallInterface (NICHT Host-NIC)', () => {
    expect(f.sourceType).toBe('firewall');
    expect(f.sourceIp).toBe('192.168.240.109');
    expect(f.destinationIp).toBe('8.8.8.8');
    expect(f.destinationPort).toBe(53);
    expect(f.protocol).toBe('udp');
    expect(f.action).toBe('block');
    expect(f.direction).toBe('outbound');
    // srcintf ist das FIREWALL-Interface, nicht die Host-NIC.
    expect(f.firewallInterface).toBe('igb0');
    expect(f.firewallIngressInterface).toBe('igb0');
    expect(f.provenance.firewallInterface.fieldPath).toBe('data.srcintf');
    expect(f.firewallRule).toBe('42');
    expect(f.bytesSent).toBe(120);
  });

  test('Host-NIC (sourceHostInterface) bleibt CE-4-pending — NICHT mit srcintf befüllt', () => {
    expect(f.sourceHostInterface).toBeNull();
    expect(f.missingReason.sourceHostInterface).toBe('inventory_not_loaded');
    expect(f.destinationHostInterface).toBeNull();
    expect(f.missingReason.destinationHostInterface).toBe('inventory_not_loaded');
  });

  test('Prozessfelder → source_provides_none; NAT (nicht im Log) → field_missing', () => {
    expect(f.processImage).toBeNull();
    expect(f.missingReason.processImage).toBe('source_provides_none');
    expect(f.processGuid).toBeNull();
    expect(f.missingReason.processGuid).toBe('source_provides_none');
    expect(f.postNatSourceIp).toBeNull();
    expect(f.missingReason.postNatSourceIp).toBe('field_missing'); // Firewall KÖNNTE, dieses Log hat es nicht
  });

  test('MAC/FQDN bleiben Inventory/TI-pending', () => {
    expect(f.missingReason.sourceMac).toBe('inventory_not_loaded');
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
  });
});

describe('normalizeFlow — CE-4.4 Event-Computer-FQDN (Sysmon)', () => {
  const sysmonComputer = (computer, over = {}) => ({
    '@timestamp': '2026-06-15T23:34:17.000Z',
    data: { win: {
      system: { eventID: '3', computer },
      eventdata: {
        protocol: 'tcp', initiated: 'true', sourceHostname: 'DC01',
        sourceIp: '10.99.99.10', sourcePort: '52835', destinationIp: '10.99.99.72', destinationPort: '8080',
        ...over,
      },
    } },
  });

  test('A) echter FQDN im Event → sourceFqdn gesetzt, Host bleibt Kurzname', () => {
    const f = normalizeFlow(sysmonComputer('DC01.nexora.example'), { now: NOW });
    expect(f.sourceFqdn).toBe('DC01.nexora.example');
    expect(f.provenance.sourceFqdn.fieldPath).toBe('data.win.system.computer');
    expect(f.provenance.sourceFqdn.confidence).toBe('high');
    expect(f.sourceHost).toBe('DC01'); // Host bleibt Kurzname
    expect(f.missingReason.sourceFqdn).toBeUndefined();
  });

  test('B) nur Kurzname im Event → kein Fake-FQDN, field_missing', () => {
    const f = normalizeFlow(sysmonComputer('DC01'), { now: NOW });
    expect(f.sourceFqdn).toBeNull();
    expect(f.missingReason.sourceFqdn).toBe('field_missing');
  });

  test('inbound (initiated=false) leitet sourceFqdn NICHT aus dem Computer ab', () => {
    const f = normalizeFlow(sysmonComputer('DC01.nexora.example', { initiated: 'false' }), { now: NOW });
    expect(f.sourceFqdn).toBeNull();
    expect(f.missingReason.sourceFqdn).toBe('field_missing');
  });

  test('destinationFqdn wird NIE aus dem Event-Computer abgeleitet (bleibt TI-pending)', () => {
    const f = normalizeFlow(sysmonComputer('DC01.nexora.example'), { now: NOW });
    expect(f.destinationFqdn).toBeNull();
    expect(f.missingReason.destinationFqdn).toBe('threat_intel_pending');
  });
});

describe('normalizeFlow — leer/unknown', () => {
  const f = normalizeFlow({ data: {} }, { now: NOW });
  test('unknown → alle null + missingReason field_missing, keine Exception', () => {
    expect(f.sourceType).toBe('unknown');
    expect(f.destinationIp).toBeNull();
    expect(f.missingReason.destinationIp).toBe('field_missing');
    expect(f.missingReason.processImage).toBe('field_missing');
  });
});
