'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 3a — Correlated Exposure Stitching (reine Engine, ADR-034).
//
// Verbindet honeypot_session/partial-Cowrie-Flow mit OPNsense-Firewall-Event,
// NUR wenn eindeutig plausibel. Ergebnis = „correlated exposure path", NIE
// behauptete NAT-Translation: natVerified immer false, provenance "correlated".
// Mehrdeutigkeit wird nicht geraten; kein Kandidat → kein Eintrag.
// ─────────────────────────────────────────────────────────────────────────

const { correlateHoneypotExposure, buildExposureCorrelations } = require('../../src/correlation/honeypotExposureCorrelation');

const session = (over = {}) => ({
  sessionId: 's1', sourceIp: '91.92.40.10', service: 'ssh', destinationPort: null,
  firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z', ...over,
});
const fw = (over = {}) => ({
  sourceType: 'firewall', sourceIp: '91.92.40.10', destinationIp: '203.0.113.7', destinationPort: 2222,
  protocol: 'tcp', action: 'pass', timestamp: '2026-06-24T08:15:35.000Z', eventId: 'fw-1', ...over,
});
const correlate = (s, f, o) => correlateHoneypotExposure(s, f, o);

describe('correlateHoneypotExposure (Slice 3a)', () => {
  test('1) eindeutiger Match (exakter Cowrie-Port, kleine Zeitdiff) → high', () => {
    const [e] = correlate([session({ destinationPort: 2222 })], [fw()]);
    expect(e.confidence).toBe('high');
    expect(e.correlationType).toBe('firewall_to_honeypot');
    expect(e.natVerified).toBe(false);
    expect(e.provenance).toBe('correlated');
    expect(e.remoteSourceIp).toBe('91.92.40.10');
    expect(e.firewallEventId).toBe('fw-1');
    expect(e.firewallDestinationPort).toBe(2222);
    expect(e.missingReason).toBeNull();
  });

  test('2) gleiche Source-IP, falsches Protokoll → kein Match', () => {
    expect(correlate([session({ destinationPort: 2222 })], [fw({ protocol: 'udp' })])).toEqual([]);
  });

  test('3) gleiche Source-IP, außerhalb Zeitfenster → kein Match', () => {
    expect(correlate([session({ destinationPort: 2222 })], [fw({ timestamp: '2026-06-24T10:30:00.000Z' })])).toEqual([]);
  });

  test('4) mehrere gleich gute Kandidaten → none + no_unique_firewall_match (keine FW-Felder)', () => {
    const [e] = correlate([session()], [
      fw({ destinationIp: '203.0.113.7', destinationPort: 2222, eventId: 'a' }),
      fw({ destinationIp: '203.0.113.8', destinationPort: 22, eventId: 'b' }),
    ]);
    expect(e.confidence).toBe('none');
    expect(e.missingReason).toBe('no_unique_firewall_match');
    expect(e.firewallDestinationIp).toBeNull();
    expect(e.firewallDestinationPort).toBeNull();
    expect(e.natVerified).toBe(false);
  });

  test('5) Cowrie ohne Zielport → maximal medium (Service-Mapping), nie high durch Annahme', () => {
    const [e] = correlate([session({ destinationPort: null })], [fw({ destinationPort: 2222 })]);
    expect(e.confidence).toBe('medium');
    expect(e.firewallDestinationPort).toBe(2222);
  });

  test('6) Online-VPS-Honeypot: Angreifer-IP NICHT in Firewall-Events → keine Korrelation behaupten', () => {
    expect(correlate([session({ sourceIp: '91.92.40.10' })], [fw({ sourceIp: '10.0.0.5' })])).toEqual([]);
  });

  test('7) Firewall-Event ohne ausreichende Felder (kein Protokoll) → kein Match', () => {
    expect(correlate([session({ destinationPort: 2222 })], [fw({ protocol: null })])).toEqual([]);
  });

  test('8) kein Firewall-Event → ehrlicher no_match (kein Eintrag)', () => {
    expect(correlate([session()], [])).toEqual([]);
  });

  test('9) mehrere identische Firewall-Events (gleiches 5-Tuple) → EIN Kandidat, nicht ambiguous', () => {
    const [e] = correlate([session({ destinationPort: 2222 })], [
      fw({ eventId: 'a', timestamp: '2026-06-24T08:15:36.000Z' }),
      fw({ eventId: 'b', timestamp: '2026-06-24T08:15:35.000Z' }),
    ]);
    expect(e.confidence).toBe('high');
    expect(e.firewallEventId).toBe('b'); // frühestes Event als Repräsentant
  });

  test('10) action=block wird abgebildet, ist aber kein Ausschlusskriterium', () => {
    const [e] = correlate([session({ destinationPort: 2222 })], [fw({ action: 'block' })]);
    expect(e.firewallAction).toBe('block');
    expect(['high', 'medium']).toContain(e.confidence);
  });

  test('Session ohne Source-IP / ohne Zeitfenster → kein Eintrag', () => {
    expect(correlate([session({ sourceIp: null })], [fw()])).toEqual([]);
    expect(correlate([session({ firstSeen: null, lastSeen: null })], [fw()])).toEqual([]);
  });
});

describe('buildExposureCorrelations (Slice 3b Orchestrator)', () => {
  test('Sessions → Fetch je IP (mit Fenster) → korrelierte Einträge', async () => {
    const fetchFirewallFlows = jest.fn(async () => ({ flows: [fw()] }));
    const res = await buildExposureCorrelations({ honeypotSessions: [session({ destinationPort: 2222 })], fetchFirewallFlows });
    expect(fetchFirewallFlows).toHaveBeenCalledTimes(1);
    expect(fetchFirewallFlows).toHaveBeenCalledWith(expect.objectContaining({
      srcIp: '91.92.40.10', firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z',
    }));
    expect(res).toHaveLength(1);
    expect(res[0].confidence).toBe('high');
  });

  test('keine Sessions → kein Fetch, leeres Array', async () => {
    const fetchFirewallFlows = jest.fn();
    expect(await buildExposureCorrelations({ honeypotSessions: [], fetchFirewallFlows })).toEqual([]);
    expect(fetchFirewallFlows).not.toHaveBeenCalled();
  });

  test('Fetch-Fehler → Soft-Fail: leeres Array, kein Throw', async () => {
    const fetchFirewallFlows = jest.fn(async () => { throw new Error('indexer down'); });
    expect(await buildExposureCorrelations({ honeypotSessions: [session({ destinationPort: 2222 })], fetchFirewallFlows })).toEqual([]);
  });

  test('mehrere distinct Angreifer-IPs → Fetch je IP', async () => {
    const fetchFirewallFlows = jest.fn(async () => ({ flows: [] }));
    await buildExposureCorrelations({
      honeypotSessions: [session({ sessionId: 'a', sourceIp: '1.1.1.1' }), session({ sessionId: 'b', sourceIp: '2.2.2.2' })],
      fetchFirewallFlows,
    });
    expect(fetchFirewallFlows).toHaveBeenCalledTimes(2);
  });
});
