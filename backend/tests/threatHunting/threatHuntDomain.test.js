'use strict';

const { ThreatHuntSession, SESSION_STATUS } = require('../../src/threatHunting/domain/ThreatHuntSession');
const { HuntCommand, COMMAND_STATUS, COMMAND_TYPE } = require('../../src/threatHunting/domain/HuntCommand');
const { HuntArtifact, ARTIFACT_TYPE } = require('../../src/threatHunting/domain/HuntArtifact');
const { HuntFinding, FINDING_SEVERITY, FINDING_CONFIDENCE, FINDING_VERDICT } = require('../../src/threatHunting/domain/HuntFinding');
const { HuntNote } = require('../../src/threatHunting/domain/HuntNote');
const { HUNT_AUDIT_EVENTS } = require('../../src/threatHunting/domain/HuntAuditEvents');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');

// ─── ThreatHuntSession ────────────────────────────────────────────────────────

describe('ThreatHuntSession', () => {
  it('erstellt eine neue Session mit Status planned', () => {
    const s = ThreatHuntSession.create({
      analystId:  'analyst-1',
      targetHost: '192.168.241.100',
      scope:      'Lateral Movement Verdacht',
    });
    expect(s.status).toBe(SESSION_STATUS.PLANNED);
    expect(s.id).toBeTruthy();
    expect(s.analystId).toBe('analyst-1');
    expect(s.targetHost).toBe('192.168.241.100');
    expect(s.ticketId).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.closedAt).toBeNull();
  });

  it('erlaubt optionale ticketId', () => {
    const s = ThreatHuntSession.create({
      analystId: 'analyst-1', targetHost: 'host-a', ticketId: 'ticket-42',
    });
    expect(s.ticketId).toBe('ticket-42');
  });

  it('schlägt fehl ohne analystId', () => {
    expect(() => ThreatHuntSession.create({ targetHost: 'host' })).toThrow(/analystId ist Pflichtfeld/);
  });

  it('schlägt fehl ohne targetHost', () => {
    expect(() => ThreatHuntSession.create({ analystId: 'analyst-1' })).toThrow(/targetHost ist Pflichtfeld/);
  });

  it('Übergang planned → active setzt startedAt', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    s.activate();
    expect(s.status).toBe(SESSION_STATUS.ACTIVE);
    expect(s.startedAt).toBeInstanceOf(Date);
  });

  it('Übergang active → completed setzt closedAt', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    s.activate();
    s.complete();
    expect(s.status).toBe(SESSION_STATUS.COMPLETED);
    expect(s.closedAt).toBeInstanceOf(Date);
    expect(s.isOpen()).toBe(false);
  });

  it('Übergang active → failed setzt closedAt', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    s.activate();
    s.fail('Timeout');
    expect(s.status).toBe(SESSION_STATUS.FAILED);
    expect(s.closedAt).toBeInstanceOf(Date);
  });

  it('planned → cancelled erlaubt (ohne activate)', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    s.cancel();
    expect(s.status).toBe(SESSION_STATUS.CANCELLED);
  });

  it('ungültiger Übergang completed → active wirft Fehler', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    s.activate();
    s.complete();
    expect(() => s.activate()).toThrow(/Ungültiger Übergang completed → active/);
  });

  it('toJSON gibt vollständiges Objekt zurück', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1', hypothesis: 'T1059' });
    const j = s.toJSON();
    expect(j.id).toBeTruthy();
    expect(j.hypothesis).toBe('T1059');
    expect(typeof j.createdAt).toBe('string');
  });

  it('fromPersistence stellt Session wieder her', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    const restored = ThreatHuntSession.fromPersistence(s.toJSON());
    expect(restored.id).toBe(s.id);
    expect(restored.status).toBe(SESSION_STATUS.PLANNED);
  });
});

// ─── HuntCommand ──────────────────────────────────────────────────────────────

describe('HuntCommand', () => {
  it('erstellt Command mit Status queued', () => {
    const c = HuntCommand.create({
      sessionId: 'session-1',
      type:      COMMAND_TYPE.MANUAL,
      command:   'netstat -an | grep 4444',
      analystId: 'analyst-1',
    });
    expect(c.status).toBe(COMMAND_STATUS.QUEUED);
    expect(c.id).toBeTruthy();
  });

  it('schlägt fehl ohne command', () => {
    expect(() => HuntCommand.create({ sessionId: 's1', type: COMMAND_TYPE.MANUAL, analystId: 'a1' }))
      .toThrow(/command ist Pflichtfeld/);
  });

  it('schlägt fehl bei ungültigem Typ', () => {
    expect(() => HuntCommand.create({ sessionId: 's1', type: 'INVALID', command: 'x', analystId: 'a1' }))
      .toThrow(/Ungültiger Typ/);
  });

  it('Lifecycle: queued → running → completed', () => {
    const c = HuntCommand.create({
      sessionId: 's1', type: COMMAND_TYPE.OSQUERY, command: 'SELECT * FROM processes', analystId: 'a1',
    });
    c.start();
    expect(c.status).toBe(COMMAND_STATUS.RUNNING);
    expect(c.executedAt).toBeInstanceOf(Date);
    c.complete({ stdout: 'PID 1337 gefunden' });
    expect(c.status).toBe(COMMAND_STATUS.COMPLETED);
    expect(c.stdout).toBe('PID 1337 gefunden');
    expect(c.result).toBe('PID 1337 gefunden');   // Legacy-Compat
  });

  it('Lifecycle: queued → blocked → queued (Requeue)', () => {
    const c = HuntCommand.create({
      sessionId: 's1', type: COMMAND_TYPE.POWERSHELL, command: 'Get-Process', analystId: 'a1',
    });
    c.block('Genehmigung ausstehend');
    expect(c.status).toBe(COMMAND_STATUS.BLOCKED);
    c.requeue();
    expect(c.status).toBe(COMMAND_STATUS.QUEUED);
  });

  it('ungültiger Übergang queued → completed wirft Fehler', () => {
    const c = HuntCommand.create({
      sessionId: 's1', type: COMMAND_TYPE.MANUAL, command: 'ls', analystId: 'a1',
    });
    expect(() => c.complete({})).toThrow(/Ungültiger Übergang queued → completed/);
  });
});

// ─── HuntArtifact ─────────────────────────────────────────────────────────────

describe('HuntArtifact', () => {
  it('erstellt Artefakt vom Typ file', () => {
    const a = HuntArtifact.create({
      sessionId: 's1',
      type:      ARTIFACT_TYPE.FILE,
      value:     'c:\\windows\\temp\\beacon.exe',
      metadata:  { hash: 'abc123', size: 45056 },
      source:    'osquery',
      analystId: 'a1',
    });
    expect(a.id).toBeTruthy();
    expect(a.type).toBe(ARTIFACT_TYPE.FILE);
    expect(a.metadata).toEqual({ hash: 'abc123', size: 45056 });
  });

  it('schlägt fehl ohne value', () => {
    expect(() => HuntArtifact.create({ sessionId: 's1', type: ARTIFACT_TYPE.IOC, analystId: 'a1' }))
      .toThrow(/value ist Pflichtfeld/);
  });

  it('schlägt fehl bei ungültigem Typ', () => {
    expect(() => HuntArtifact.create({ sessionId: 's1', type: 'BLAH', value: 'x', analystId: 'a1' }))
      .toThrow(/Ungültiger Typ/);
  });

  it('fromPersistence parst metadata-String', () => {
    const a = HuntArtifact.create({ sessionId: 's1', type: ARTIFACT_TYPE.IOC, value: '1.2.3.4', analystId: 'a1' });
    const raw = { ...a.toJSON(), metadata: JSON.stringify({ port: 4444 }) };
    const restored = HuntArtifact.fromPersistence(raw);
    expect(restored.metadata).toEqual({ port: 4444 });
  });
});

// ─── HuntFinding ──────────────────────────────────────────────────────────────

describe('HuntFinding', () => {
  it('erstellt Finding mit allen Pflichtfeldern', () => {
    const f = HuntFinding.create({
      sessionId:  's1',
      title:      'Verdächtige Reverse Shell',
      severity:   FINDING_SEVERITY.HIGH,
      confidence: FINDING_CONFIDENCE.HIGH,
      analystId:  'a1',
    });
    expect(f.id).toBeTruthy();
    expect(f.severity).toBe('high');
    expect(f.ticketId).toBeNull();
    expect(f.artifactIds).toEqual([]);
  });

  it('schlägt fehl bei ungültiger Severity', () => {
    expect(() => HuntFinding.create({ sessionId: 's1', title: 't', severity: 'EXTREME', confidence: 'high', analystId: 'a1' }))
      .toThrow(/Ungültige Severity/);
  });

  it('addArtifact fügt ID hinzu und setzt updatedAt', async () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    const before = f.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    f.addArtifact('art-42');
    expect(f.artifactIds).toContain('art-42');
    expect(f.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('addArtifact ignoriert Duplikate', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    f.addArtifact('art-1');
    f.addArtifact('art-1');
    expect(f.artifactIds.length).toBe(1);
  });

  it('linkToTicket setzt ticketId', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'medium', confidence: 'low', analystId: 'a1' });
    f.linkToTicket('ticket-99');
    expect(f.ticketId).toBe('ticket-99');
  });

  it('fromPersistence parst artifactIds-String', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'low', confidence: 'low', analystId: 'a1' });
    const raw = { ...f.toJSON(), artifactIds: JSON.stringify(['a1', 'a2']) };
    const restored = HuntFinding.fromPersistence(raw);
    expect(restored.artifactIds).toEqual(['a1', 'a2']);
  });

  // ─── Verdict (Block B2) ───────────────────────────────────────────────────

  it('FINDING_VERDICT enthält benign, suspicious, malicious, inconclusive und leer', () => {
    expect(FINDING_VERDICT.BENIGN).toBe('benign');
    expect(FINDING_VERDICT.SUSPICIOUS).toBe('suspicious');
    expect(FINDING_VERDICT.MALICIOUS).toBe('malicious');
    expect(FINDING_VERDICT.INCONCLUSIVE).toBe('inconclusive');
    expect(FINDING_VERDICT.NONE).toBe('');
  });

  it('verdict-Default ist leerer String', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    expect(f.verdict).toBe('');
  });

  it('toJSON enthält verdict-Feld', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'medium', confidence: 'medium', analystId: 'a1' });
    expect(Object.prototype.hasOwnProperty.call(f.toJSON(), 'verdict')).toBe(true);
    expect(f.toJSON().verdict).toBe('');
  });

  it('setVerdict setzt gültiges Verdict und aktualisiert updatedAt', async () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    const before = f.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    f.setVerdict('benign');
    expect(f.verdict).toBe('benign');
    expect(f.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('setVerdict erlaubt alle FINDING_VERDICT-Werte', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'low', confidence: 'low', analystId: 'a1' });
    expect(() => f.setVerdict('suspicious')).not.toThrow();
    expect(() => f.setVerdict('malicious')).not.toThrow();
    expect(() => f.setVerdict('inconclusive')).not.toThrow();
    expect(() => f.setVerdict('')).not.toThrow();
  });

  it('setVerdict wirft bei ungültigem Wert', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'low', confidence: 'low', analystId: 'a1' });
    expect(() => f.setVerdict('hacked')).toThrow(/Ungültiges Verdict/);
    expect(() => f.setVerdict(null)).toThrow(/Ungültiges Verdict/);
  });

  it('fromPersistence stellt verdict korrekt wieder her', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    f.setVerdict('suspicious');
    const raw = { ...f.toJSON() };
    const restored = HuntFinding.fromPersistence(raw);
    expect(restored.verdict).toBe('suspicious');
  });

  it('fromPersistence setzt verdict auf leeren String wenn Spalte fehlt (Migration)', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'low', confidence: 'low', analystId: 'a1' });
    const raw = { ...f.toJSON() };
    delete raw.verdict;
    const restored = HuntFinding.fromPersistence(raw);
    expect(restored.verdict).toBe('');
  });

  it('context bleibt unangetastet beim setVerdict', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'low', confidence: 'low', analystId: 'a1', context: { host: 'srv1', verdict: 'old-ctx-value' } });
    f.setVerdict('benign');
    expect(f.context.host).toBe('srv1');
    expect(f.context.verdict).toBe('old-ctx-value');
    expect(f.verdict).toBe('benign');
  });
});

// ─── HuntNote ─────────────────────────────────────────────────────────────────

describe('HuntNote', () => {
  it('erstellt Notiz', () => {
    const n = HuntNote.create({ sessionId: 's1', content: 'Prozess sieht verdächtig aus', analystId: 'a1' });
    expect(n.id).toBeTruthy();
    expect(n.content).toBe('Prozess sieht verdächtig aus');
  });

  it('schlägt fehl ohne content', () => {
    expect(() => HuntNote.create({ sessionId: 's1', content: '', analystId: 'a1' }))
      .toThrow(/content ist Pflichtfeld/);
  });
});

// ─── HuntAuditEvents ──────────────────────────────────────────────────────────

describe('HUNT_AUDIT_EVENTS', () => {
  it('enthält alle erwarteten Session-Events', () => {
    expect(HUNT_AUDIT_EVENTS.SESSION_CREATED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.SESSION_ACTIVATED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.SESSION_COMPLETED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.SESSION_FAILED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.SESSION_CANCELLED).toBeTruthy();
  });

  it('enthält alle erwarteten Command-Events', () => {
    expect(HUNT_AUDIT_EVENTS.COMMAND_ADDED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.COMMAND_STARTED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.COMMAND_COMPLETED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.COMMAND_FAILED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.COMMAND_BLOCKED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.COMMAND_REQUEUED).toBeTruthy();
  });

  it('enthält Artifact, Finding, Note, Link Events', () => {
    expect(HUNT_AUDIT_EVENTS.ARTIFACT_COLLECTED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.FINDING_CREATED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.FINDING_LINKED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.ARTIFACT_LINKED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.SUMMARY_LINKED).toBeTruthy();
    expect(HUNT_AUDIT_EVENTS.NOTE_ADDED).toBeTruthy();
  });

  it('alle Werte sind unique Strings', () => {
    const values = Object.values(HUNT_AUDIT_EVENTS);
    const unique  = new Set(values);
    expect(values.length).toBe(unique.size);
  });
});

// ─── InMemoryHuntRepository ───────────────────────────────────────────────────

describe('InMemoryHuntRepository', () => {
  let repo;

  beforeEach(() => { repo = new InMemoryHuntRepository(); });

  it('speichert und liest Session', async () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    await repo.saveSession(s.toJSON());
    const found = await repo.findSessionById(s.id);
    expect(found.id).toBe(s.id);
  });

  it('findSessionsByTicketId gibt nur passende Sessions zurück', async () => {
    const s1 = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1', ticketId: 't-1' });
    const s2 = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h2', ticketId: 't-2' });
    await repo.saveSession(s1.toJSON());
    await repo.saveSession(s2.toJSON());
    const results = await repo.findSessionsByTicketId('t-1');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(s1.id);
  });

  it('speichert Command + findet per sessionId', async () => {
    const c = HuntCommand.create({ sessionId: 's1', type: COMMAND_TYPE.MANUAL, command: 'ls', analystId: 'a1' });
    await repo.saveCommand(c.toJSON());
    const results = await repo.findCommandsBySession('s1');
    expect(results.length).toBe(1);
  });

  it('speichert Artifact + findet per commandId', async () => {
    const a = HuntArtifact.create({
      sessionId: 's1', commandId: 'cmd-1', type: ARTIFACT_TYPE.IOC, value: '10.0.0.1', analystId: 'a1',
    });
    await repo.saveArtifact(a.toJSON());
    const results = await repo.findArtifactsByCommand('cmd-1');
    expect(results.length).toBe(1);
  });

  it('speichert Finding + findet per ticketId', async () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 't', severity: 'high', confidence: 'high', analystId: 'a1' });
    f.linkToTicket('ticket-7');
    await repo.saveFinding(f.toJSON());
    const results = await repo.findFindingsByTicket('ticket-7');
    expect(results.length).toBe(1);
  });

  it('counts() gibt korrekte Zahlen zurück', async () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    await repo.saveSession(s.toJSON());
    const n = HuntNote.create({ sessionId: s.id, content: 'Notiz', analystId: 'a1' });
    await repo.saveNote(n.toJSON());
    expect(repo.counts()).toEqual({ sessions: 1, commands: 0, artifacts: 0, findings: 0, notes: 1, ticketLinks: 0 });
  });

  it('clear() leert alle Stores', async () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    await repo.saveSession(s.toJSON());
    repo.clear();
    expect(await repo.findSessionById(s.id)).toBeNull();
  });
});
