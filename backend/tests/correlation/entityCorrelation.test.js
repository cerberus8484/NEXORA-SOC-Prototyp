'use strict';

const { extractEntities, mergeEntities, correlateEntities } = require('../../src/correlation/entityCorrelation');

function ev(overrides = {}) {
  return {
    detection: { sourceSystem: 'Wazuh' },
    source: {}, destination: {}, nat: {}, metadata: {},
    firstSeen: '2026-06-16T10:00:00Z', lastSeen: '2026-06-16T10:30:00Z',
    ...overrides,
  };
}

describe('extractEntities', () => {
  test('zieht Host/User/IP/MAC/Domain/Prozess/Hash aus einem Event', () => {
    const refs = extractEntities(ev({
      source: { host: 'DC01', user: 'alice', ip: '10.0.0.5', macAddress: 'aa:bb:cc:dd:ee:ff' },
      destination: { ip: '8.8.8.8', fqdn: 'evil.test' },
      process: { image: 'C:\\powershell.exe', hashes: 'SHA256=abc,MD5=def' },
    }));
    const kinds = refs.map((r) => `${r.kind}:${r.value}`);
    expect(kinds).toEqual(expect.arrayContaining([
      'user:alice', 'host:DC01', 'ip:10.0.0.5', 'ip:8.8.8.8',
      'mac:aa:bb:cc:dd:ee:ff', 'domain:evil.test', 'process:C:\\powershell.exe',
      'hash:abc', 'hash:def',
    ]));
    expect(refs.every((r) => r.source === 'Wazuh')).toBe(true);
  });

  test('dedupliziert innerhalb eines Events (Host=AgentName nur einmal)', () => {
    const refs = extractEntities(ev({ source: { host: 'DC01' }, metadata: { agentName: 'DC01' } }));
    expect(refs.filter((r) => r.kind === 'host')).toHaveLength(1);
  });
});

describe('mergeEntities', () => {
  test('führt gleiche Entity über Quellen zusammen — Provenance + Event-Count', () => {
    const merged = mergeEntities([
      { kind: 'host', value: 'DC01', source: 'Wazuh', firstSeen: '2026-06-16T09:00:00Z', lastSeen: '2026-06-16T09:30:00Z' },
      { kind: 'host', value: 'dc01', source: 'Wazuh', firstSeen: '2026-06-16T10:00:00Z', lastSeen: '2026-06-16T11:00:00Z' },
      { kind: 'host', value: 'DC01', source: 'QRadar', firstSeen: '2026-06-16T08:00:00Z', lastSeen: '2026-06-16T08:30:00Z' },
    ]);
    expect(merged).toHaveLength(1);
    const e = merged[0];
    expect(e.value).toBe('DC01');               // case-insensitiv gemergt, erste Schreibweise
    expect(e.events).toBe(3);
    expect(e.sources).toEqual([{ source: 'Wazuh', count: 2 }, { source: 'QRadar', count: 1 }]);
    expect(e.firstSeen).toBe('2026-06-16T08:00:00Z'); // min
    expect(e.lastSeen).toBe('2026-06-16T11:00:00Z');  // max
  });
});

describe('correlateEntities (über mehrere Events)', () => {
  test('aggregiert Host aus N Events + distinkte Destination-IPs', () => {
    const evs = [
      ev({ source: { host: 'DC01', ip: '10.99.99.10' }, destination: { ip: '8.8.8.8' } }),
      ev({ source: { host: 'DC01' }, destination: { ip: '1.1.1.1' } }),
    ];
    const ents = correlateEntities(evs);
    const host = ents.find((e) => e.kind === 'host' && e.value === 'DC01');
    expect(host.events).toBe(2);
    const dstIps = ents.filter((e) => e.kind === 'ip').map((e) => e.value);
    expect(dstIps).toEqual(expect.arrayContaining(['10.99.99.10', '8.8.8.8', '1.1.1.1']));
  });
});
