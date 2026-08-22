'use strict';

const { normalizeGenericEvidence, normalizeEvidence } = require('../../src/correlation/evidenceNormalizer');

describe('normalizeGenericEvidence', () => {
  test('mappt flache Ticketfelder in ParsedEvidence (Source/Destination/Network)', () => {
    const ticket = {
      id: 't1', source: 'qradar', priority: 'high', status: 'assigned',
      hostname: 'SRV01', user: 'alice', srcIp: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff',
      network: 'DMZ', port: '445', dstIp: '8.8.8.8', dstFqdn: 'dns.google',
      protocol: 'tcp', mitre: 'T1059', category: 'authentication',
      description: 'desc', createdAt: '2026-06-16T10:00:00Z', updatedAt: '2026-06-16T11:00:00Z',
    };
    const ev = normalizeGenericEvidence(ticket);
    expect(ev.detection.sourceSystem).toBe('QRadar');
    expect(ev.detection.severity).toBe('High');
    expect(ev.source.host).toBe('SRV01');
    expect(ev.source.ip).toBe('10.0.0.5');
    expect(ev.source.macAddress).toBe('aa:bb:cc:dd:ee:ff');
    expect(ev.source.zone).toBe('DMZ');
    expect(ev.source.port).toBe(445);
    expect(ev.destination.ip).toBe('8.8.8.8');
    expect(ev.destination.fqdn).toBe('dns.google');
    expect(ev.network.protocol).toBe('tcp');
    expect(ev.metadata.mitreTechnique).toBe('T1059');
  });

  test('leere Felder bleiben undefined (ADR-009: keine Fake-Daten)', () => {
    const ev = normalizeGenericEvidence({ id: 't2', source: 'splunk' });
    expect(ev.source.host).toBeUndefined();
    expect(ev.source.ip).toBeUndefined();
    expect(ev.destination.ip).toBeUndefined();
    expect(ev.detection.sourceSystem).toBe('Splunk');
  });

  test('Flow-Statistik: Pakete/Firewall-Action/Events/Fenster/Dauer werden gemappt', () => {
    const ev = normalizeGenericEvidence({
      id: 't3', source: 'crowdsec',
      pktsSent: '6210', pktsRecv: '1840', firewallAction: 'permitted', eventCount: '7',
      firstSeen: '2026-06-16T10:00:00Z', lastSeen: '2026-06-16T10:05:00Z',
    });
    expect(ev.network.packetsSent).toBe(6210);
    expect(ev.network.packetsReceived).toBe(1840);
    expect(ev.network.action).toBe('permitted');
    expect(ev.network.eventCount).toBe(7);
    expect(ev.network.firstSeen).toBe('2026-06-16T10:00:00Z');
    expect(ev.network.lastSeen).toBe('2026-06-16T10:05:00Z');
    expect(ev.network.durationMs).toBe(300000); // 5 min
  });

  test('top-level firstSeen/lastSeen bevorzugen das Flow-Fenster vor created/updatedAt', () => {
    const ev = normalizeGenericEvidence({
      id: 't4', source: 'wazuh_generic_fallback',
      firstSeen: '2026-06-16T09:00:00Z', lastSeen: '2026-06-16T09:30:00Z',
      createdAt: '2026-06-16T12:00:00Z', updatedAt: '2026-06-16T12:10:00Z',
    });
    expect(ev.firstSeen).toBe('2026-06-16T09:00:00Z');
    expect(ev.lastSeen).toBe('2026-06-16T09:30:00Z');
  });

  test('destination.ip fällt auf extIp/attackerIp zurück, wenn dstIp fehlt', () => {
    expect(normalizeGenericEvidence({ id: 'a', extIp: '185.10.10.10' }).destination.ip).toBe('185.10.10.10');
    expect(normalizeGenericEvidence({ id: 'b', attackerIp: '185.20.20.20' }).destination.ip).toBe('185.20.20.20');
    // dstIp hat Vorrang
    expect(normalizeGenericEvidence({ id: 'c', dstIp: '1.1.1.1', extIp: '2.2.2.2' }).destination.ip).toBe('1.1.1.1');
  });

  test('kein Flow-Fenster → durationMs/firstSeen bleiben undefined (keine Fake-Daten)', () => {
    const ev = normalizeGenericEvidence({ id: 't5', source: 'manual' });
    expect(ev.network.durationMs).toBeUndefined();
    expect(ev.network.packetsSent).toBeUndefined();
    expect(ev.network.action).toBeUndefined();
  });
});

describe('normalizeEvidence (Dispatcher)', () => {
  test('wazuh → Rich-Normalizer liest das Roh-Event', () => {
    const raw = { data: { srcip: '1.2.3.4' }, agent: { name: 'DC01', id: '009' } };
    const ev = normalizeEvidence({ id: 'w1', source: 'wazuh', logs: `Raw Alert (JSON): ${JSON.stringify(raw)}` });
    expect(ev.source.host).toBe('DC01');
    expect(ev.source.ip).toBe('1.2.3.4');
  });

  test('nicht-wazuh Quelle → generischer Normalizer (nie null)', () => {
    const ev = normalizeEvidence({ id: 'q1', source: 'qradar', srcIp: '9.9.9.9' });
    expect(ev).not.toBeNull();
    expect(ev.source.ip).toBe('9.9.9.9');
    expect(ev.detection.sourceSystem).toBe('QRadar');
  });

  test('unbekannte Quelle → generisch mit Roh-source als Label', () => {
    const ev = normalizeEvidence({ id: 'x1', source: 'sentinel', hostname: 'H1' });
    expect(ev.source.host).toBe('H1');
    expect(ev.detection.sourceSystem).toBe('sentinel');
  });
});
