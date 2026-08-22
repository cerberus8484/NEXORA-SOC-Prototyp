'use strict';

// Roundtrip-Mapping-Tests für PostgresHuntRepository — ohne echte DB.
// Invariante: _rowToX(simulierte_pg_row) === domain.toJSON()
// (gleiche Strategie wie postgresTicketMapping.test.js)

const { PostgresHuntRepository } = require('../../src/threatHunting/repositories/PostgresHuntRepository');
const { ThreatHuntSession } = require('../../src/threatHunting/domain/ThreatHuntSession');
const { HuntCommand, COMMAND_TYPE } = require('../../src/threatHunting/domain/HuntCommand');
const { HuntArtifact, ARTIFACT_TYPE } = require('../../src/threatHunting/domain/HuntArtifact');
const { HuntFinding } = require('../../src/threatHunting/domain/HuntFinding');
const { HuntNote } = require('../../src/threatHunting/domain/HuntNote');
const { HuntTicketLink, LINK_SOURCE_TYPE } = require('../../src/threatHunting/domain/HuntTicketLink');

const repo = new PostgresHuntRepository();

/** ISO-String → Date, mimt pg-Rückgabe; null bleibt null */
const d = (iso) => (iso ? new Date(iso) : null);

describe('PostgresHuntRepository — Session Mapping', () => {
  it('_rowToSession rekonstruiert toJSON-Form', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1', ticketId: 't1', scope: 'sc', hypothesis: 'hy' });
    s.activate();
    const j = s.toJSON();

    const row = {
      id: j.id, ticket_id: j.ticketId, analyst_id: j.analystId, target_host: j.targetHost,
      scope: j.scope, hypothesis: j.hypothesis, status: j.status,
      created_at: d(j.createdAt), updated_at: d(j.updatedAt), started_at: d(j.startedAt), closed_at: d(j.closedAt),
    };
    expect(repo._rowToSession(row)).toEqual(j);
  });

  it('null-Datumsfelder bleiben null', () => {
    const s = ThreatHuntSession.create({ analystId: 'a1', targetHost: 'h1' });
    const j = s.toJSON();
    const row = {
      id: j.id, ticket_id: null, analyst_id: j.analystId, target_host: j.targetHost,
      scope: j.scope, hypothesis: j.hypothesis, status: j.status,
      created_at: d(j.createdAt), updated_at: d(j.updatedAt), started_at: null, closed_at: null,
    };
    const mapped = repo._rowToSession(row);
    expect(mapped.startedAt).toBeNull();
    expect(mapped.closedAt).toBeNull();
    expect(mapped.ticketId).toBeNull();
  });

  it('_rowToSession(undefined) → null', () => {
    expect(repo._rowToSession(undefined)).toBeNull();
  });
});

describe('PostgresHuntRepository — Command Mapping', () => {
  it('_rowToCommand rekonstruiert toJSON-Form (running → completed)', () => {
    const c = HuntCommand.create({ sessionId: 's1', type: COMMAND_TYPE.OSQUERY, command: 'SELECT 1', analystId: 'a1' });
    c.start();
    c.complete({ stdout: 'out', stderr: 'err', exitCode: 0 });
    const j = c.toJSON();

    const row = {
      id: j.id, session_id: j.sessionId, type: j.type, command: j.command, description: j.description,
      status: j.status, result: j.result, stdout: j.stdout, stderr: j.stderr,
      exit_code: j.exitCode, blocked_reason: j.blockedReason, analyst_id: j.analystId,
      created_at: d(j.createdAt), updated_at: d(j.updatedAt), executed_at: d(j.executedAt), completed_at: d(j.completedAt),
    };
    expect(repo._rowToCommand(row)).toEqual(j);
  });

  it('exit_code null bleibt null', () => {
    const c = HuntCommand.create({ sessionId: 's1', type: COMMAND_TYPE.MANUAL, command: 'ls', analystId: 'a1' });
    const j = c.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, type: j.type, command: j.command, description: j.description,
      status: j.status, result: j.result, stdout: j.stdout, stderr: j.stderr,
      exit_code: null, blocked_reason: j.blockedReason, analyst_id: j.analystId,
      created_at: d(j.createdAt), updated_at: d(j.updatedAt), executed_at: null, completed_at: null,
    };
    expect(repo._rowToCommand(row).exitCode).toBeNull();
  });
});

describe('PostgresHuntRepository — Artifact Mapping', () => {
  it('metadata als Objekt (pg jsonb) korrekt gemappt', () => {
    const a = HuntArtifact.create({
      sessionId: 's1', commandId: 'c1', type: ARTIFACT_TYPE.FILE, value: 'x.exe',
      metadata: { hash: 'abc', size: 42 }, source: 'osquery', analystId: 'a1',
    });
    const j = a.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, command_id: j.commandId, type: j.type, value: j.value,
      metadata: { hash: 'abc', size: 42 }, source: j.source, analyst_id: j.analystId, created_at: d(j.createdAt),
    };
    expect(repo._rowToArtifact(row)).toEqual(j);
  });

  it('metadata als String (pg text fallback) wird geparst', () => {
    const a = HuntArtifact.create({ sessionId: 's1', type: ARTIFACT_TYPE.IOC, value: '1.2.3.4', analystId: 'a1' });
    const j = a.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, command_id: null, type: j.type, value: j.value,
      metadata: '{"port":4444}', source: j.source, analyst_id: j.analystId, created_at: d(j.createdAt),
    };
    expect(repo._rowToArtifact(row).metadata).toEqual({ port: 4444 });
  });
});

describe('PostgresHuntRepository — Finding Mapping', () => {
  it('artifactIds als Array (pg jsonb) korrekt gemappt', () => {
    const f = HuntFinding.create({
      sessionId: 's1', title: 'T', severity: 'high', confidence: 'high',
      artifactIds: ['a1', 'a2'], mitreAttack: 'T1059', recommendation: 'isolate', analystId: 'an1',
    });
    f.linkToTicket('t1');
    const j = f.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, title: j.title, description: j.description,
      severity: j.severity, confidence: j.confidence, artifact_ids: ['a1', 'a2'],
      mitre_attack: j.mitreAttack, recommendation: j.recommendation, analyst_id: j.analystId,
      ticket_id: j.ticketId, created_at: d(j.createdAt), updated_at: d(j.updatedAt),
    };
    expect(repo._rowToFinding(row)).toEqual(j);
  });

  it('artifact_ids als String wird geparst', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 'T', severity: 'low', confidence: 'low', analystId: 'a1' });
    const j = f.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, title: j.title, description: j.description,
      severity: j.severity, confidence: j.confidence, artifact_ids: '["x","y"]',
      mitre_attack: j.mitreAttack, recommendation: j.recommendation, analyst_id: j.analystId,
      ticket_id: null, created_at: d(j.createdAt), updated_at: d(j.updatedAt),
    };
    expect(repo._rowToFinding(row).artifactIds).toEqual(['x', 'y']);
  });
});

describe('PostgresHuntRepository — Note Mapping', () => {
  it('_rowToNote rekonstruiert toJSON-Form', () => {
    const n = HuntNote.create({ sessionId: 's1', content: 'note', analystId: 'a1' });
    const j = n.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, content: j.content, analyst_id: j.analystId, created_at: d(j.createdAt),
    };
    expect(repo._rowToNote(row)).toEqual(j);
  });
});

describe('PostgresHuntRepository — TicketLink Mapping', () => {
  it('_rowToLink rekonstruiert toJSON-Form inkl. deduplicationKey', () => {
    const l = HuntTicketLink.create({
      huntSessionId: 's1', ticketId: 't1', sourceType: LINK_SOURCE_TYPE.FINDING, sourceId: 'f1',
      summary: 'Reverse Shell', linkedBy: 'a1',
    });
    const j = l.toJSON();
    const row = {
      id: j.id, hunt_session_id: j.huntSessionId, ticket_id: j.ticketId, source_type: j.sourceType,
      source_id: j.sourceId, summary: j.summary, linked_by: j.linkedBy, linked_at: d(j.linkedAt),
      deduplication_key: j.deduplicationKey,
    };
    expect(repo._rowToLink(row)).toEqual(j);
  });
});

describe('PostgresHuntRepository — Finding Verdict Round-Trip', () => {
  it('verdict wird in _rowToFinding gemappt (Spalte vorhanden)', () => {
    const f = HuntFinding.create({
      sessionId: 's1', title: 'T', severity: 'high', confidence: 'high', analystId: 'an1',
    });
    f.setVerdict('suspicious');
    const j = f.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, title: j.title, description: j.description,
      severity: j.severity, confidence: j.confidence, artifact_ids: [],
      mitre_attack: j.mitreAttack, recommendation: j.recommendation, analyst_id: j.analystId,
      ticket_id: null, created_at: d(j.createdAt), updated_at: d(j.updatedAt),
      context: {}, verdict: 'suspicious',
    };
    const mapped = repo._rowToFinding(row);
    expect(mapped.verdict).toBe('suspicious');
  });

  it('verdict-Default leerer String wenn DB-Spalte NULL (vor Migration)', () => {
    const f = HuntFinding.create({ sessionId: 's1', title: 'T', severity: 'low', confidence: 'low', analystId: 'a1' });
    const j = f.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, title: j.title, description: j.description,
      severity: j.severity, confidence: j.confidence, artifact_ids: [],
      mitre_attack: '', recommendation: '', analyst_id: j.analystId,
      ticket_id: null, created_at: d(j.createdAt), updated_at: d(j.updatedAt),
      context: {}, verdict: null,
    };
    const mapped = repo._rowToFinding(row);
    expect(mapped.verdict).toBe('');
  });

  it('toJSON mit verdict wird vollständig gemappt (round-trip)', () => {
    const f = HuntFinding.create({
      sessionId: 's1', title: 'T', severity: 'high', confidence: 'medium',
      artifactIds: ['a1'], mitreAttack: 'T1059', recommendation: 'isolate', analystId: 'an1',
    });
    f.setVerdict('benign');
    f.linkToTicket('t1');
    const j = f.toJSON();
    const row = {
      id: j.id, session_id: j.sessionId, title: j.title, description: j.description,
      severity: j.severity, confidence: j.confidence, artifact_ids: j.artifactIds,
      mitre_attack: j.mitreAttack, recommendation: j.recommendation, analyst_id: j.analystId,
      ticket_id: j.ticketId, created_at: d(j.createdAt), updated_at: d(j.updatedAt),
      context: j.context, verdict: j.verdict,
    };
    expect(repo._rowToFinding(row)).toEqual(j);
  });
});

describe('PostgresHuntRepository — Vertrags-Parität mit InMemory', () => {
  it('implementiert alle Methoden, die HuntService aufruft', () => {
    const required = [
      'saveSession', 'findSessionById', 'findSessionsByTicketId', 'findSessionsByAnalyst', 'findAllSessions',
      'saveCommand', 'findCommandById', 'findCommandsBySession',
      'saveArtifact', 'findArtifactById', 'findArtifactsBySession', 'findArtifactsByCommand',
      'saveFinding', 'findFindingById', 'findFindingsBySession', 'findFindingsByTicket',
      'saveNote', 'findNotesBySession',
      'saveTicketLink', 'findTicketLinkByDeduplicationKey', 'findTicketLinksBySession', 'findTicketLinksByTicket',
    ];
    for (const m of required) {
      expect(typeof repo[m]).toBe('function');
    }
  });
});
