import { describe, it, expect } from 'vitest';
import {
  wellKnownService, externalIps, deriveConversations, deriveFlowStats, deriveNatTranslation, deriveGeo,
  deriveTrafficBreakdown,
} from './networkModel';
import { EMPTY_EVIDENCE, type ParsedEvidence, type TicketTimeline, type NetworkCorrelation, type NetworkFlow } from '../analysisModel';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({ ...EMPTY_EVIDENCE, ...over });

const flow = (over: Partial<NetworkFlow>): NetworkFlow => ({
  sourceType: 'firewall', timestamp: null,
  sourceIp: null, sourcePort: null, sourceHost: null, sourceFqdn: null, sourceMac: null, sourceHostInterface: null, sourceZone: null,
  destinationIp: null, destinationPort: null, destinationHost: null, destinationFqdn: null, destinationMac: null, destinationHostInterface: null, destinationZone: null,
  protocol: null, transport: null, direction: null, action: null,
  bytesSent: null, bytesReceived: null, packetsSent: null, packetsReceived: null, durationMs: null,
  originalSourceIp: null, originalSourcePort: null, postNatSourceIp: null, postNatSourcePort: null,
  originalDestinationIp: null, originalDestinationPort: null, postNatDestinationIp: null, postNatDestinationPort: null,
  natType: null, natRule: null, firewallRule: null,
  processImage: null, processId: null, processGuid: null, user: null, ...over,
});
const corr = (flows: NetworkFlow[], top: NetworkCorrelation['topConversations'] = []): NetworkCorrelation => ({ flows, topConversations: top });
const tl = (events: TicketTimeline['events'], over: Partial<TicketTimeline> = {}): TicketTimeline => ({
  count: events.length, first: null, last: null, dstPorts: [], actions: [], events, ...over,
});

describe('wellKnownService', () => {
  it('mappt bekannte Ports', () => {
    expect(wellKnownService(443)).toBe('HTTPS');
    expect(wellKnownService(53)).toBe('DNS');
    expect(wellKnownService(5985)).toBe('WinRM');
  });
  it('ist undefined für unbekannte/fehlende Ports', () => {
    expect(wellKnownService(64999)).toBeUndefined();
    expect(wellKnownService(undefined)).toBeUndefined();
  });
});

describe('externalIps', () => {
  it('sammelt deduplizierte Ziel-IPs ohne die interne Quelle', () => {
    const ips = externalIps(
      ticket({ srcIp: '192.168.241.102', dstIp: '203.0.113.45' }),
      ev({ source: { ...EMPTY_EVIDENCE.source, ip: '192.168.241.102' }, destination: { ...EMPTY_EVIDENCE.destination, ip: '203.0.113.45' } }),
      tl([{ time: 't', dstIp: '198.51.100.23' }, { time: 't', dstIp: '203.0.113.45' }]),
      corr([flow({ destinationIp: '192.0.2.11' })]),
    );
    // Reihenfolge: Destination/NAT → topConversations → Flows → Timeline-Events (dedupliziert)
    expect(ips).toEqual(['203.0.113.45', '192.0.2.11', '198.51.100.23']);
    expect(ips).not.toContain('192.168.241.102');
  });
});

describe('deriveConversations', () => {
  it('aggregiert Flows mit Bytes + lastSeen, sortiert nach Events', () => {
    const rows = deriveConversations(null, corr([
      flow({ destinationIp: '203.0.113.45', destinationPort: 443, protocol: 'tcp', bytesSent: 1000, bytesReceived: 200, timestamp: '2026-06-20T10:00:00Z' }),
      flow({ destinationIp: '203.0.113.45', destinationPort: 443, protocol: 'tcp', bytesSent: 500, bytesReceived: 100, timestamp: '2026-06-20T10:05:00Z' }),
      flow({ destinationIp: '198.51.100.23', destinationPort: 53, protocol: 'udp', bytesSent: 50, bytesReceived: 50, timestamp: '2026-06-20T09:00:00Z' }),
    ]));
    expect(rows[0].destinationIp).toBe('203.0.113.45');
    expect(rows[0].events).toBe(2);
    expect(rows[0].bytes).toBe(1800);
    expect(rows[0].lastSeen).toBe('2026-06-20T10:05:00Z');
    expect(rows[1].destinationIp).toBe('198.51.100.23');
  });
  it('verfolgt firstSeen (Minimum) je Conversation aus Flow-Zeitstempeln', () => {
    const rows = deriveConversations(null, corr([
      flow({ destinationIp: '203.0.113.45', destinationPort: 443, protocol: 'tcp', timestamp: '2026-06-20T10:05:00Z' }),
      flow({ destinationIp: '203.0.113.45', destinationPort: 443, protocol: 'tcp', timestamp: '2026-06-20T10:00:00Z' }),
    ]));
    expect(rows[0].firstSeen).toBe('2026-06-20T10:00:00Z');
    expect(rows[0].lastSeen).toBe('2026-06-20T10:05:00Z');
  });
  it('verfolgt firstSeen auch im Timeline-Fallback', () => {
    const rows = deriveConversations(tl([
      { time: '2026-06-20T10:02:00Z', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp' },
      { time: '2026-06-20T10:00:00Z', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp' },
    ]), null);
    expect(rows[0].firstSeen).toBe('2026-06-20T10:00:00Z');
    expect(rows[0].lastSeen).toBe('2026-06-20T10:02:00Z');
  });
  it('fällt auf Timeline-Events zurück (Events + lastSeen, keine Bytes)', () => {
    const rows = deriveConversations(tl([
      { time: '2026-06-20T10:00:00Z', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp' },
      { time: '2026-06-20T10:01:00Z', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp' },
    ]), null);
    expect(rows).toHaveLength(1);
    expect(rows[0].events).toBe(2);
    expect(rows[0].bytes).toBeNull();
    expect(rows[0].lastSeen).toBe('2026-06-20T10:01:00Z');
  });
  it('ist leer ohne jede Quelle', () => {
    expect(deriveConversations(null, null)).toHaveLength(0);
  });
});

describe('deriveFlowStats', () => {
  it('nutzt ev.network bevorzugt', () => {
    const s = deriveFlowStats(ev({ network: { ...EMPTY_EVIDENCE.network, bytesSent: 13107, bytesReceived: 9626, packetsSent: 100, packetsReceived: 54, durationMs: 134000 } }), tl([{ time: 't' }, { time: 't' }]));
    expect(s.bytesSent).toBe(13107);
    expect(s.bytesReceived).toBe(9626);
    expect(s.packets).toBe(154);
    expect(s.durationMs).toBe(134000);
    expect(s.totalEvents).toBe(2);
  });
  it('summiert aus Flows, wenn ev.network leer ist', () => {
    const s = deriveFlowStats(EMPTY_EVIDENCE, null, corr([
      flow({ bytesSent: 100, bytesReceived: 50, packetsSent: 2, packetsReceived: 1, durationMs: 1000 }),
      flow({ bytesSent: 200, bytesReceived: 60, packetsSent: 3, packetsReceived: 1, durationMs: 5000 }),
    ]));
    expect(s.bytesSent).toBe(300);
    expect(s.bytesReceived).toBe(110);
    expect(s.packets).toBe(7);
    expect(s.durationMs).toBe(5000);
    expect(s.totalEvents).toBe(2);
  });
  it('berechnet Duration aus Flow-Start/Ende, wenn durationMs fehlt', () => {
    const s = deriveFlowStats(EMPTY_EVIDENCE, null, corr([
      flow({ bytesSent: 58, bytesReceived: 0, flowStart: '2026-06-28T10:00:00Z', flowEnd: '2026-06-28T10:00:07Z' }),
    ]));
    expect(s.durationMs).toBe(7000);
  });
  it('berechnet Duration aus Timeline-First/Last, wenn keine Flows vorhanden sind', () => {
    const s = deriveFlowStats(ev({ network: { ...EMPTY_EVIDENCE.network, bytesSent: 58, bytesReceived: 0 } }), tl([], {
      count: 1,
      first: '2026-06-28T10:00:00Z',
      last: '2026-06-28T10:00:00Z',
    }), null);
    expect(s.durationMs).toBe(0);
  });
  it('nutzt ev.network.eventCount als totalEvents, wenn keine Timeline/Flows da sind (Dataplane-Ticket)', () => {
    const s = deriveFlowStats(ev({ network: {
      ...EMPTY_EVIDENCE.network,
      bytesSent: 1840, bytesReceived: 1450, packetsSent: 12, packetsReceived: 9, eventCount: 4,
      firstSeen: '2026-06-25T12:00:00Z', lastSeen: '2026-06-25T12:01:00Z',
    } }), null, null);
    expect(s.totalEvents).toBe(4);
    expect(s.packets).toBe(21);
    expect(s.bytesSent).toBe(1840);
    expect(s.durationMs).toBe(60000); // firstSeen→lastSeen
  });
});

describe('deriveTrafficBreakdown', () => {
  it('summiert Total, Denied und Permitted aus echten Network-Flows', () => {
    const s = deriveTrafficBreakdown(EMPTY_EVIDENCE, null, corr([
      flow({ action: 'block', bytesSent: 100, bytesReceived: 20, timestamp: '2026-06-28T10:01:00Z' }),
      flow({ action: 'pass', bytesSent: 300, bytesReceived: 80, flowStart: '2026-06-28T10:02:00Z', flowEnd: '2026-06-28T10:02:30Z' }),
      flow({ action: 'allow', bytesSent: 50, bytesReceived: 10, timestamp: '2026-06-28T10:03:00Z' }),
      flow({ action: null, bytesSent: 999, bytesReceived: 1, timestamp: '2026-06-28T10:04:00Z' }),
    ]));
    expect(s.total).toEqual({ events: 4, bytes: 1560, firstSeen: '2026-06-28T10:01:00Z', lastSeen: '2026-06-28T10:04:00Z' });
    expect(s.denied).toEqual({ events: 1, bytes: 120, firstSeen: '2026-06-28T10:01:00Z', lastSeen: '2026-06-28T10:01:00Z' });
    expect(s.permitted).toEqual({ events: 2, bytes: 440, firstSeen: '2026-06-28T10:02:00Z', lastSeen: '2026-06-28T10:03:00Z' });
  });

  it('liefert für ein Dataplane-Ticket (nur ev.network) nicht-leere Total- und Denied-Buckets', () => {
    const s = deriveTrafficBreakdown(ev({
      detection: { ...EMPTY_EVIDENCE.detection, timestamp: '25.06.26, 12:00' },
      network: {
        ...EMPTY_EVIDENCE.network,
        bytesSent: 1840, bytesReceived: 1450, packetsSent: 12, packetsReceived: 9,
        action: 'block', eventCount: 4,
        firstSeen: '2026-06-25T12:00:00Z', lastSeen: '2026-06-25T12:01:00Z',
      },
    }), null, null);
    expect(s.total.events).toBe(4);
    expect(s.total.bytes).toBe(3290);
    expect(s.denied.events).toBe(4);
    expect(s.denied.bytes).toBe(3290);
    expect(s.denied.firstSeen).toBe('2026-06-25T12:00:00Z');
    expect(s.denied.lastSeen).toBe('2026-06-25T12:01:00Z');
    expect(s.permitted.events).toBe(0);
  });

  it('fällt für Total-First/Last auf die Detektionszeit zurück, wenn Traffic da ist aber kein Zeitfenster', () => {
    // Dataplane-Ticket: Bytes vorhanden, aber keine Flows/Timeline und kein ev.network-Fenster.
    const s = deriveTrafficBreakdown(ev({
      detection: { ...EMPTY_EVIDENCE.detection, timestamp: '2026-06-25T12:00:00Z' },
      network: { ...EMPTY_EVIDENCE.network, bytesSent: 100, bytesReceived: 24 },
    }), null, null);
    expect(s.total.bytes).toBe(124);
    expect(s.total.firstSeen).toBe('2026-06-25T12:00:00Z');
    expect(s.total.lastSeen).toBe('2026-06-25T12:00:00Z');
  });
  it('erfindet keinen Zeitstempel, wenn gar kein Traffic vorliegt', () => {
    const s = deriveTrafficBreakdown(ev({
      detection: { ...EMPTY_EVIDENCE.detection, timestamp: '2026-06-25T12:00:00Z' },
    }), null, null);
    expect(s.total.firstSeen).toBeNull();
  });
  it('nutzt Timeline-Actions als Fallback, wenn keine Flows geladen sind', () => {
    const s = deriveTrafficBreakdown(EMPTY_EVIDENCE, tl([
      { time: '2026-06-28T10:00:00Z', action: 'drop' },
      { time: '2026-06-28T10:04:00Z', action: 'drop' },
      { time: '2026-06-28T10:02:00Z', action: 'Allowed' },
    ], {
      count: 9,
      first: '2026-06-28T10:00:00Z',
      last: '2026-06-28T10:05:00Z',
      actions: [{ action: 'drop', count: 3 }, { action: 'Allowed', count: 4 }, { action: 'other', count: 2 }],
    }), null);
    expect(s.total).toEqual({ events: 9, bytes: null, firstSeen: '2026-06-28T10:00:00Z', lastSeen: '2026-06-28T10:05:00Z' });
    expect(s.denied).toEqual({ events: 3, bytes: null, firstSeen: '2026-06-28T10:00:00Z', lastSeen: '2026-06-28T10:04:00Z' });
    expect(s.permitted).toEqual({ events: 4, bytes: null, firstSeen: '2026-06-28T10:02:00Z', lastSeen: '2026-06-28T10:02:00Z' });
  });
});

describe('deriveNatTranslation', () => {
  it('baut Pre→Post mit Passthrough für unveränderte Felder', () => {
    const rows = deriveNatTranslation(ticket(), ev({
      source: { ...EMPTY_EVIDENCE.source, ip: '192.168.241.102', port: 49451 },
      destination: { ...EMPTY_EVIDENCE.destination, ip: '203.0.113.45', port: 443 },
      nat: { ...EMPTY_EVIDENCE.nat, postNatSourceIp: '203.0.113.45', postNatSourcePort: 51123 },
      network: { ...EMPTY_EVIDENCE.network, protocol: 'tcp' },
    }));
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Source IP']).toMatchObject({ pre: '192.168.241.102', post: '203.0.113.45' });
    expect(byLabel['Source Port']).toMatchObject({ pre: '49451', post: '51123' });
    // Destination unverändert → Passthrough post = pre
    expect(byLabel['Destination IP']).toMatchObject({ pre: '203.0.113.45', post: '203.0.113.45' });
    expect(byLabel['Protocol']).toMatchObject({ pre: 'TCP', post: 'TCP' });
  });
  it('ist leer ohne NAT-Evidence', () => {
    expect(deriveNatTranslation(ticket({ srcIp: '10.0.0.1', dstIp: '8.8.8.8' }), EMPTY_EVIDENCE)).toHaveLength(0);
  });

  it('zeigt keine Translation für identische Pre- und Post-NAT-Werte', () => {
    const rows = deriveNatTranslation(ticket(), ev({
      source: { ...EMPTY_EVIDENCE.source, ip: '10.10.20.48', port: 22 },
      destination: { ...EMPTY_EVIDENCE.destination, ip: '10.10.20.91', port: 22 },
      nat: { ...EMPTY_EVIDENCE.nat, postNatSourceIp: '10.10.20.48', postNatDestinationIp: '10.10.20.91' },
      network: { ...EMPTY_EVIDENCE.network, protocol: 'ssh' },
    }));
    expect(rows).toEqual([]);
  });
});

describe('deriveGeo', () => {
  it('liest reale Destination-Felder', () => {
    const g = deriveGeo(ev({ destination: { ...EMPTY_EVIDENCE.destination, ip: '203.0.113.45', country: 'United States', organization: 'Cloudflare, Inc.', asn: 'AS13335', reputation: 'malicious' } }));
    expect(g).toMatchObject({ country: 'United States', organization: 'Cloudflare, Inc.', asn: 'AS13335', reputation: 'malicious', hasAny: true });
  });
  it('meldet hasAny=false ohne Geo-Daten', () => {
    expect(deriveGeo(EMPTY_EVIDENCE).hasAny).toBe(false);
  });
  it('bevorzugt Auto-Threat-Intel (Honeypot-Angreifer-Source-IP)', () => {
    const network = { flows: [], topConversations: [], threatIntel: [{
      indicatorValue: '176.65.139.88', verdict: 'malicious', score: 100, confidence: 67,
      source: 'provider', country: 'NL', asnOwner: 'Offshore LC', usageType: 'Data Center/Web Hosting/Transit', totalReports: 1262,
    }] } as unknown as Parameters<typeof deriveGeo>[1];
    const g = deriveGeo(EMPTY_EVIDENCE, network);
    expect(g).toMatchObject({
      ip: '176.65.139.88', ipLabel: 'Angreifer-IP', country: 'NL', organization: 'Offshore LC',
      usageType: 'Data Center/Web Hosting/Transit', reports: 1262, reputation: 'malicious (100)', source: 'provider', hasAny: true,
    });
  });
  it('fällt auf Destination-Felder zurück, wenn kein Threat-Intel', () => {
    const network = { flows: [], topConversations: [], threatIntel: [] } as unknown as Parameters<typeof deriveGeo>[1];
    expect(deriveGeo(EMPTY_EVIDENCE, network).hasAny).toBe(false);
  });
});

// Slice 1c — Smoke: ein backend-normalisierter Cowrie-Flow läuft sauber durch das
// Network-&-NAT-Modell (Post-DNAT-Sicht; keine erfundenen NAT/Geo-Werte).
describe('Cowrie-Honeypot-Flows (Slice 1 Smoke)', () => {
  const cowrieConnect = flow({
    sourceType: 'cowrie', timestamp: '2026-06-24T08:15:30.123456Z',
    sourceIp: '185.220.101.45', sourcePort: 49152,
    destinationIp: '10.99.99.80', destinationPort: 2222, protocol: 'tcp', direction: 'inbound',
    service: 'ssh', sessionId: 'a1b2c3d4e5f6', sensorId: 'nexora-honeypot',
    connectionState: 'established', flowStart: '2026-06-24T08:15:30.123456Z',
  });
  const cowrieClosed = flow({
    sourceType: 'cowrie', timestamp: '2026-06-24T08:20:00.500000Z',
    sourceIp: '185.220.101.45', protocol: 'tcp', direction: 'inbound',
    sessionId: 'a1b2c3d4e5f6', sensorId: 'nexora-honeypot',
    connectionState: 'closed', durationMs: 270500, flowEnd: '2026-06-24T08:20:00.500000Z',
  });

  it('erscheint als Conversation auf die interne Honeypot-IP (Post-DNAT)', () => {
    const rows = deriveConversations(null, corr([cowrieConnect]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ destinationIp: '10.99.99.80', destinationPort: 2222, protocol: 'tcp', events: 1 });
  });

  it('Session-Dauer fließt in die Flow-Statistik; keine Byte-Werte erfunden', () => {
    const stats = deriveFlowStats(EMPTY_EVIDENCE, null, corr([cowrieConnect, cowrieClosed]));
    expect(stats.durationMs).toBe(270500);
    expect(stats.bytesSent).toBeNull();
    expect(stats.bytesReceived).toBeNull();
  });

  it('liefert keine NAT-Translation (Honeypot sieht nur Post-DNAT)', () => {
    expect(deriveNatTranslation(ticket(), EMPTY_EVIDENCE, corr([cowrieConnect]))).toHaveLength(0);
  });
});

// S1 — Suricata-Flows liefern echte Bytes/Pakete/Dauer in Conversations + Flow-Statistik.
describe('Suricata-Flows (S1 Smoke)', () => {
  const sf = flow({
    sourceType: 'suricata', timestamp: '2026-06-19T21:20:53.000Z',
    sourceIp: '185.220.101.45', destinationIp: '10.99.99.80', destinationPort: 2222, protocol: 'tcp',
    bytesSent: 1234, bytesReceived: 5678, packetsSent: 10, packetsReceived: 8, durationMs: 3000,
  });

  it('erscheint mit echten Bytes in den Conversations', () => {
    const rows = deriveConversations(null, corr([sf]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ destinationIp: '10.99.99.80', destinationPort: 2222, protocol: 'tcp', bytes: 6912 });
  });

  it('Bytes/Pakete/Dauer fließen in die Flow-Statistik', () => {
    const s = deriveFlowStats(EMPTY_EVIDENCE, null, corr([sf]));
    expect(s.bytesSent).toBe(1234);
    expect(s.bytesReceived).toBe(5678);
    expect(s.packets).toBe(18);
    expect(s.durationMs).toBe(3000);
  });
});
