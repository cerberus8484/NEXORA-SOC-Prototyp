'use strict';

// P_NIS2_1 — Postgres-Mapping + Methoden-Vertrag(=InMemory) + Factory (ohne DB).
const config = require('../../src/config');
const { PostgresNis2Repository } = require('../../src/repositories/PostgresNis2Repository');
const { InMemoryNis2Repository } = require('../../src/repositories/InMemoryNis2Repository');
const { createNis2Repository } = require('../../src/repositories/nis2RepositoryFactory');

const repo = new PostgresNis2Repository();
const T = new Date('2026-06-18T12:00:00.000Z');

describe('PostgresNis2Repository — row → domain mapping', () => {
  test('_toAssessment (snake → camel, Date → ISO)', () => {
    expect(repo._toAssessment({
      id: 'a1', control_key: 'incident_handling', status: 'in_progress', owner: 'SecTeam',
      due_date: T, notes: 'n', last_reviewed_at: T, created_at: T, updated_at: T, created_by: 'x', updated_by: 'y',
    })).toEqual({
      id: 'a1', controlKey: 'incident_handling', status: 'in_progress', owner: 'SecTeam',
      dueDate: T.toISOString(), notes: 'n', lastReviewedAt: T.toISOString(),
      createdAt: T.toISOString(), updatedAt: T.toISOString(), createdBy: 'x', updatedBy: 'y',
    });
  });
  test('_toEvidence (snake → camel)', () => {
    expect(repo._toEvidence({
      id: 'e1', assessment_id: 'a1', evidence_type: 'ticket', evidence_ref: 'INC1', title: 'T',
      description: 'd', captured_at: null, created_at: T, created_by: 'x',
    })).toEqual({
      id: 'e1', assessmentId: 'a1', evidenceType: 'ticket', evidenceRef: 'INC1', title: 'T',
      description: 'd', capturedAt: null, createdAt: T.toISOString(), createdBy: 'x',
    });
  });
});

describe('NIS2 Repo — Methoden-Vertrag = InMemory', () => {
  test('gleiche öffentliche Methoden', () => {
    const pub = (obj) => Object.getOwnPropertyNames(Object.getPrototypeOf(obj))
      .filter((m) => m !== 'constructor' && !m.startsWith('_') && typeof obj[m] === 'function').sort();
    expect(pub(repo)).toEqual(pub(new InMemoryNis2Repository()));
  });
});

describe('nis2RepositoryFactory (config.db.enabled)', () => {
  const original = config.db.enabled;
  afterEach(() => { config.db.enabled = original; });
  test('deaktiviert → InMemory', () => {
    config.db.enabled = false;
    expect(createNis2Repository()).toBeInstanceOf(InMemoryNis2Repository);
  });
  test('aktiviert → Postgres', () => {
    config.db.enabled = true;
    expect(createNis2Repository()).toBeInstanceOf(PostgresNis2Repository);
  });
});
