'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Generischer Normalizer — vollständige Feld-Übernahme.
//
// Der generische Normalizer griff für ALLE Quellen außer wazuh (qradar, splunk,
// email, crowdsec, dataplane, manuell) und las ausschließlich flache Netzwerk-
// felder. Verworfen wurden:
//   1. `process` / `commandLine` / `hash` am Ticket — obwohl der Frontend-Fallback
//      `buildEvidence()` sie SEHR WOHL liest ⇒ dieselbe Information war je nach Weg
//      mal da, mal nicht (Widerspruch zwischen Anzeige und maßgeblicher Evidence).
//   2. `payloads[]` — typisierte Artefakte (Command/Login), die der Data-Plane-
//      Korrelator bereits mitliefert.
//   3. `logs` — der Roh-Alert (nur wazuh parste ihn).
//   4. `payload.contains*` — vier fest verdrahtete 'unknown', ohne je hineinzusehen.
//
// Bewusst NICHT gemappt: Tunnel-/Download-Aktivität wird von der Payloads-Ansicht
// bereits direkt aus `ticket.payloads` gerendert (sessionActivityModel) — doppeltes
// Mapping wäre Redundanz, kein Gewinn.
// ─────────────────────────────────────────────────────────────────────────

const { normalizeGenericEvidence, normalizeEvidence } = require('../../src/correlation/evidenceNormalizer');

const cmdPayload   = (raw, at) => ({ type: 'Command', raw, fields: { kind: 'command', at } });
const loginPayload = (user)    => ({ type: 'Andere', raw: '', fields: { kind: 'login', user } });

describe('1. Flache Prozess-Felder (behebt Frontend/Backend-Widerspruch)', () => {
  test('process + commandLine + hash landen in process', () => {
    const ev = normalizeGenericEvidence({
      id: 'q1', source: 'qradar', process: 'powershell.exe',
      commandLine: 'powershell -enc AAAA', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    expect(ev.process.image).toBe('powershell.exe');
    expect(ev.process.commandLine).toBe('powershell -enc AAAA');
    expect(ev.process.hashes).toBe('sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(ev.type).toBe('process');
  });

  test('Hash ohne Prozess wird zur Datei-Evidence (kein Doppeleintrag)', () => {
    const ev = normalizeGenericEvidence({ id: 'q2', source: 'splunk', hash: 'd41d8cd98f00b204e9800998ecf8427e' });

    expect(ev.process).toBeUndefined();
    expect(ev.file.hashes).toBe('md5=d41d8cd98f00b204e9800998ecf8427e');
  });

  test('ohne Prozess-/Hash-Felder wird nichts erfunden', () => {
    const ev = normalizeGenericEvidence({ id: 'q3', source: 'splunk', srcIp: '10.0.0.1' });

    expect(ev.process).toBeUndefined();
    expect(ev.file).toBeUndefined();
    expect(ev.type).toBe('network');
  });
});

describe('2. Payload-Artefakte (jetzt für JEDE Quelle, nicht nur dataplane)', () => {
  test('Command-Payload füllt process.commandLine', () => {
    const ev = normalizeGenericEvidence({ id: 'd1', source: 'dataplane', payloads: [cmdPayload('uname -s -m', '2026-08-01T08:56:15Z')] });

    expect(ev.process.commandLine).toBe('uname -s -m');
    expect(ev.type).toBe('process');
  });

  test('Login-Payload füllt source.user', () => {
    const ev = normalizeGenericEvidence({ id: 'd2', source: 'dataplane', payloads: [loginPayload('root')] });

    expect(ev.source.user).toBe('root');
  });

  test('mehrere Befehle: erster führt, Gesamtzahl bleibt ehrlich sichtbar', () => {
    const ev = normalizeGenericEvidence({ id: 'd3', source: 'dataplane', payloads: [cmdPayload('whoami'), cmdPayload('id'), cmdPayload('uname -a')] });

    expect(ev.process.commandLine).toBe('whoami');
    expect(ev.process.commandCount).toBe(3);
  });

  test('flaches Feld hat Vorrang vor Payload (explizit schlägt abgeleitet)', () => {
    const ev = normalizeGenericEvidence({ id: 'd4', source: 'dataplane', user: 'flach', commandLine: 'echo flach', payloads: [loginPayload('ausPayload'), cmdPayload('echo payload')] });

    expect(ev.source.user).toBe('flach');
    expect(ev.process.commandLine).toBe('echo flach');
  });

  test('leere/kaputte Payloads werden ignoriert statt zu werfen', () => {
    const ev = normalizeGenericEvidence({ id: 'd5', source: 'dataplane', payloads: [null, 'quatsch', { type: 'Command', raw: '' }] });

    expect(ev.process).toBeUndefined();
  });
});

describe('3. Roh-Log wird durchgereicht', () => {
  test('logs landen in raw (für Quellen ohne eigenen Parser)', () => {
    const ev = normalizeGenericEvidence({ id: 'l1', source: 'crowdsec', logs: 'Aug 1 08:00 sshd: Failed password for root' });

    expect(String(ev.raw)).toContain('Failed password');
  });

  test('ohne logs bleibt raw leer (nichts erfunden)', () => {
    expect(normalizeGenericEvidence({ id: 'l2', source: 'crowdsec' }).raw).toBeUndefined();
  });
});

describe('4. payload.contains* wird ERMITTELT statt behauptet', () => {
  test('Base64 + Script werden im Befehl erkannt', () => {
    const ev = normalizeGenericEvidence({
      id: 'p1', source: 'qradar',
      commandLine: 'powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA',
    });

    expect(ev.payload.containsBase64).toBe(true);
    expect(ev.payload.containsScript).toBe(true);
  });

  test('Zugangsdaten und Token werden erkannt', () => {
    const ev = normalizeGenericEvidence({ id: 'p2', source: 'qradar', logs: 'user=admin password=Sommer2026 authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' });

    expect(ev.payload.containsCredentials).toBe(true);
    expect(ev.payload.containsToken).toBe(true);
  });

  test('harmloser Text ⇒ false, nicht "unknown" (es wurde ja geprüft)', () => {
    const ev = normalizeGenericEvidence({ id: 'p3', source: 'qradar', commandLine: 'ls -la /tmp' });

    expect(ev.payload.containsBase64).toBe(false);
    expect(ev.payload.containsCredentials).toBe(false);
  });

  test('OHNE prüfbaren Text bleibt es ehrlich bei "unknown"', () => {
    const ev = normalizeGenericEvidence({ id: 'p4', source: 'qradar', srcIp: '10.0.0.1' });

    expect(ev.payload.containsBase64).toBe('unknown');
    expect(ev.payload.containsCredentials).toBe('unknown');
  });
});

describe('Zusammenspiel / keine Regression', () => {
  test('wazuh behält seinen eigenen (reicheren) Normalizer', () => {
    const raw = { rule: { id: '1', description: 'x' }, agent: { id: '001' }, data: { win: { eventdata: { image: 'a.exe', commandLine: 'a.exe -x' } } } };
    const ev = normalizeEvidence({ id: 'w', source: 'wazuh', logs: `Raw Alert (JSON): ${JSON.stringify(raw)}` });

    expect(ev.process.image).toBe('a.exe');
  });

  test('dataplane läuft jetzt über den generischen Pfad — mit identischem Ergebnis', () => {
    const ev = normalizeEvidence({ id: 'dp', source: 'dataplane', srcIp: '1.2.3.4', payloads: [loginPayload('root'), cmdPayload('uname -s -m')] });

    expect(ev.process.commandLine).toBe('uname -s -m');
    expect(ev.process.user).toBe('root');
    expect(ev.source.user).toBe('root');
    expect(ev.source.ip).toBe('1.2.3.4');
  });
});
