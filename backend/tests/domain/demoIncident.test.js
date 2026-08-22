'use strict';

// Der Demo-Incident muss (a) das echte create-Schema bestehen und (b) JEDE Deck-Sektion
// mit Daten belegen — sonst wäre der „alle Daten kommen an"-Nachweis lückenhaft.

const { buildDemoIncident, DEMO_MARKER } = require('../../src/domain/demoIncident');
const { createTicketSchema } = require('../../src/domain/validation/ticketSchema');

describe('buildDemoIncident', () => {
  test('besteht das echte createTicketSchema (real anlegbar)', () => {
    const { error } = createTicketSchema.validate(buildDemoIncident(), { abortEarly: false });
    expect(error).toBeUndefined();
  });

  test('trägt den Idempotenz-Marker', () => {
    expect(buildDemoIncident().offenseId).toBe(DEMO_MARKER);
  });

  test('Overview/Klassifikation befüllt', () => {
    const t = buildDemoIncident();
    expect(t.title).toMatch(/LSASS|C2/i);
    expect(t.priority).toBe('critical');
    expect(t.decision).toBe('incident');
    expect(t.confidence).toBeGreaterThan(0);
    expect(t.mitre).toMatch(/T1003\.001/);
  });

  test('Identity-Sektion befüllt', () => {
    const t = buildDemoIncident();
    expect(t.user).toBeTruthy();
    expect(t.email).toMatch(/@/);
    expect(t.dept).toBeTruthy();
  });

  test('Network + NAT + Flow-Statistik befüllt', () => {
    const t = buildDemoIncident();
    for (const k of ['srcIp', 'dstIp', 'port', 'protocol', 'bytesSent', 'pktsSent', 'firstSeen', 'lastSeen', 'postNatSrc', 'postNatDst']) {
      expect(String(t[k])).not.toBe('');
    }
  });

  test('System-Sektion befüllt (Prozess/CommandLine/Hash)', () => {
    const t = buildDemoIncident();
    expect(t.process).toMatch(/powershell/i);
    expect(t.commandLine).toMatch(/EncodedCommand/i);
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('IOCs mehrzeilig (IP, Domain, URL, Hash)', () => {
    const lines = buildDemoIncident().iocs.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.join(' ')).toMatch(/185\.220\.101\.47/);
  });

  test('Commands: mind. ein Command-Payload mit dekodierbarem EncodedCommand', () => {
    const cmd = buildDemoIncident().payloads.find((p) => p.type === 'Command');
    expect(cmd).toBeTruthy();
    expect(cmd.fields.commandLine).toMatch(/EncodedCommand\s+[A-Za-z0-9+/=]+/);
  });

  test('Threat-Intel-Einträge vorhanden', () => {
    const ti = buildDemoIncident().tiEntries;
    expect(ti.length).toBeGreaterThanOrEqual(1);
    expect(ti[0].category).toBeTruthy();
  });

  test('Evidence/Logs: Raw-Alert-JSON ist parsebar und trägt MITRE + Netzwerk', () => {
    const logs = buildDemoIncident().logs;
    expect(logs).toContain('Raw Alert (JSON):');
    const json = JSON.parse(logs.slice(logs.indexOf('{')));
    expect(json.rule.mitre.id).toContain('T1003.001');
    expect(json.data.dstip).toBe('185.220.101.47');
    expect(json.data.win.eventdata.commandLine).toMatch(/EncodedCommand/);
  });

  test('Analyst-Workflow: Checkliste + Playbook', () => {
    const s = buildDemoIncident().analystState;
    expect(s.checklist.length).toBeGreaterThanOrEqual(3);
    expect(s.playbook.status).toBe('in_progress');
  });
});
