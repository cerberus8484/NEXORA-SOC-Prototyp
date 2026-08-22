'use strict';

const { mergeEvidence, correlate } = require('../../src/correlation/CorrelationEngine');
const { TicketService } = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');

// Minimal-ParsedEvidence für die Merge-Unit-Tests.
function ev(overrides = {}) {
  return {
    id: 'e', type: 'network',
    detection: { sourceSystem: 'Wazuh' },
    source: {}, destination: {}, nat: {}, network: {},
    payload: { containsBase64: 'unknown' }, metadata: {},
    firstSeen: undefined, lastSeen: undefined, raw: undefined,
    ...overrides,
  };
}

describe('mergeEvidence', () => {
  test('leere Liste → null', () => {
    expect(mergeEvidence([])).toBeNull();
    expect(mergeEvidence(null)).toBeNull();
  });

  test('einzelnes Event → unverändert + correlation-Meta (eventCount 1)', () => {
    const merged = mergeEvidence([ev({ source: { host: 'DC01' } })]);
    expect(merged.source.host).toBe('DC01');
    expect(merged.correlation.eventCount).toBe(1);
    expect(merged.correlation.sources).toEqual([{ source: 'Wazuh', count: 1 }]);
    expect(merged.correlation.entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'host', value: 'DC01' })]),
    );
  });

  test('Parent-Inventar + Child-Flow werden feldweise zusammengeführt', () => {
    const parent = ev({
      type: 'network',
      source: { host: 'DC01', ip: '10.99.99.10', macAddress: 'aa:bb:cc:dd:ee:ff' },
      firstSeen: '2026-06-16T09:00:00Z', lastSeen: '2026-06-16T09:30:00Z',
    });
    const child = ev({
      type: 'process',
      source: { host: 'DC01', user: 'alice' },
      destination: { ip: '8.8.8.8' },
      network: { protocol: 'tcp' },
      payload: { containsBase64: true },
      process: { image: 'powershell.exe' },
      firstSeen: '2026-06-16T10:00:00Z', lastSeen: '2026-06-16T11:00:00Z',
    });
    const m = mergeEvidence([parent, child]);

    expect(m.type).toBe('process');                       // spezifischer Typ gewinnt
    expect(m.source.host).toBe('DC01');
    expect(m.source.macAddress).toBe('aa:bb:cc:dd:ee:ff'); // nur Parent hat MAC
    expect(m.source.user).toBe('alice');                  // nur Child hat User
    expect(m.destination.ip).toBe('8.8.8.8');             // leeres Parent-Feld aus Child gefüllt
    expect(m.network.protocol).toBe('tcp');
    expect(m.payload.containsBase64).toBe(true);          // 'unknown' wird überstimmt
    expect(m.process.image).toBe('powershell.exe');       // optionale Gruppe gesetzt
    expect(m.firstSeen).toBe('2026-06-16T09:00:00Z');     // min
    expect(m.lastSeen).toBe('2026-06-16T11:00:00Z');      // max
    expect(m.correlation.eventCount).toBe(2);
  });

  test('Provenance zählt Quellen über alle Events', () => {
    const m = mergeEvidence([
      ev({ detection: { sourceSystem: 'Wazuh' } }),
      ev({ detection: { sourceSystem: 'Wazuh' } }),
      ev({ detection: { sourceSystem: 'QRadar' } }),
    ]);
    expect(m.correlation.sources).toEqual([
      { source: 'Wazuh', count: 2 },
      { source: 'QRadar', count: 1 },
    ]);
  });
});

describe('correlate (Ticket + Childs)', () => {
  test('Host-Case + Child-Offense → Inventar (Source) + Flow (Destination)', () => {
    const parent = { id: 'p', source: 'wazuh', kind: 'case', hostname: 'DC01', srcIp: '10.99.99.10', mac: '00:0c:29:ab:cd:ef' };
    const childRaw = { data: { dstip: '8.8.8.8', dstport: 53, protocol: 'udp' }, agent: { name: 'DC01', id: '009' } };
    const child = { id: 'c', source: 'wazuh', logs: `Raw Alert (JSON): ${JSON.stringify(childRaw)}` };

    const m = correlate(parent, [child]);
    expect(m.source.host).toBe('DC01');
    expect(m.source.macAddress).toBe('00:0c:29:ab:cd:ef'); // aus dem Parent-Inventar
    expect(m.destination.ip).toBe('8.8.8.8');              // aus der Child-Offense
    expect(m.network.protocol).toBe('udp');
    expect(m.correlation.eventCount).toBe(2);
  });

  test('Einzel-Ticket ohne Childs → eigene Evidence + Meta', () => {
    const m = correlate({ id: 's', source: 'qradar', srcIp: '9.9.9.9' }, []);
    expect(m.source.ip).toBe('9.9.9.9');
    expect(m.correlation.eventCount).toBe(1);
  });
});

describe('TicketService.findChildren', () => {
  test('liefert nur Childs des Parents (neueste zuerst)', async () => {
    const svc = new TicketService(new InMemoryTicketRepository());
    const parent = await svc.create({ title: 'Case', kind: 'case', source: 'wazuh' });
    await svc.create({ title: 'A', kind: 'alert', source: 'wazuh', parentId: parent.id });
    await svc.create({ title: 'B', kind: 'alert', source: 'wazuh', parentId: parent.id });
    await svc.create({ title: 'Fremd', kind: 'alert', source: 'wazuh' }); // ohne parentId

    const kids = await svc.findChildren(parent.id);
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.parentId === parent.id)).toBe(true);
  });

  test('ohne parentId → leeres Array', async () => {
    const svc = new TicketService(new InMemoryTicketRepository());
    expect(await svc.findChildren('')).toEqual([]);
  });
});
