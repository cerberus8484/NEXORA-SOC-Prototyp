'use strict';

// Postgres-Repo: Mapping + Vertrags-Parität zum InMemory-Repo, OHNE Live-DB
// (injizierte queryFn). Prüft snake→camel-Mapping, Compare-and-Set-Verhalten
// und gleiche öffentliche Methoden.

const { PostgresConfigRepository } = require('../../src/configRegistry/PostgresConfigRepository');
const { InMemoryConfigRepository } = require('../../src/configRegistry/InMemoryConfigRepository');

function fakeQuery(handler) { return (sql, params) => Promise.resolve(handler(sql, params)); }

describe('PostgresConfigRepository — Mapping', () => {
  test('_toDraft mappt snake_case + Date → camelCase + ISO', () => {
    const repo = new PostgresConfigRepository({ queryFn: fakeQuery(() => ({ rowCount: 0, rows: [] })) });
    const row = {
      id: 'd1', capability_id: 'correlator.worker.maxChildren', target_id: 'correlation-worker',
      value: { maxChildren: 50 }, status: 'draft', version: 2, revision: 2, created_by: 'eng',
      created_at: new Date('2026-06-22T10:00:00Z'), updated_at: new Date('2026-06-22T10:05:00Z'),
    };
    const d = repo._toDraft(row);
    expect(d).toMatchObject({ id: 'd1', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', status: 'draft', version: 2, revision: 2, createdBy: 'eng' });
    expect(d.createdAt).toBe('2026-06-22T10:00:00.000Z');
    expect(d.value.maxChildren).toBe(50);
  });

  test('_toAudit mappt before_redacted/after_redacted → before/after', () => {
    const repo = new PostgresConfigRepository({ queryFn: fakeQuery(() => ({ rowCount: 0, rows: [] })) });
    const a = repo._toAudit({ id: 'a1', type: 'config.draft.created', actor: 'eng', capability_id: 'x', target_id: 't', draft_id: 'd1', before_redacted: null, after_redacted: { maxChildren: 5 }, at: new Date('2026-06-22T10:00:00Z') });
    expect(a).toMatchObject({ id: 'a1', capabilityId: 'x', targetId: 't', draftId: 'd1', before: null });
    expect(a.after.maxChildren).toBe(5);
  });
});

describe('PostgresConfigRepository — Optimistic Locking (Compare-and-Set)', () => {
  test('updateDraft mit Versionskonflikt → 409', async () => {
    let call = 0;
    const repo = new PostgresConfigRepository({ queryFn: fakeQuery((sql) => {
      call += 1;
      if (/UPDATE config_drafts/.test(sql)) return { rowCount: 0, rows: [] };       // CAS schlägt fehl
      if (/SELECT version FROM config_drafts/.test(sql)) return { rowCount: 1, rows: [{ version: 5 }] };
      return { rowCount: 0, rows: [] };
    }) });
    await expect(repo.updateDraft({ id: 'd1', capabilityId: 'x', targetId: 't', value: {}, status: 'draft', version: 6, revision: 6, createdBy: 'e', updatedAt: 'now' }, 1))
      .rejects.toMatchObject({ status: 409 });
    expect(call).toBe(2); // UPDATE + Konflikt-SELECT
  });

  test('updateDraft auf nicht existierenden Draft → 404', async () => {
    const repo = new PostgresConfigRepository({ queryFn: fakeQuery((sql) => {
      if (/UPDATE config_drafts/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT version FROM config_drafts/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    }) });
    await expect(repo.updateDraft({ id: 'nope', capabilityId: 'x', targetId: 't', value: {}, status: 'draft', version: 2, revision: 2, createdBy: 'e', updatedAt: 'now' }, 1))
      .rejects.toMatchObject({ status: 404 });
  });

  test('createDraft schreibt value als JSONB-String + mappt RETURNING zurück', async () => {
    let insertedValueParam;
    const repo = new PostgresConfigRepository({ queryFn: fakeQuery((sql, params) => {
      if (/INSERT INTO config_drafts/.test(sql)) {
        insertedValueParam = params[3];
        return { rowCount: 1, rows: [{ id: params[0], capability_id: params[1], target_id: params[2], value: { maxChildren: 7 }, status: 'draft', version: 1, revision: 1, created_by: 'e', created_at: new Date(), updated_at: new Date() }] };
      }
      return { rowCount: 0, rows: [] };
    }) });
    const d = await repo.createDraft({ id: 'd1', capabilityId: 'c', targetId: 't', value: { maxChildren: 7 }, status: 'draft', version: 1, revision: 1, createdBy: 'e', createdAt: 'now', updatedAt: 'now' });
    expect(typeof insertedValueParam).toBe('string');         // jsonb als String
    expect(JSON.parse(insertedValueParam).maxChildren).toBe(7);
    expect(d.value.maxChildren).toBe(7);
  });
});

describe('PostgresConfigRepository — Vertrags-Parität zum InMemory', () => {
  test('gleiche öffentlichen Methoden wie InMemoryConfigRepository', () => {
    const publicMethods = (proto) => Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && !n.startsWith('_') && typeof proto[n] === 'function');
    const mem = publicMethods(InMemoryConfigRepository.prototype).sort();
    const pg = publicMethods(PostgresConfigRepository.prototype).sort();
    for (const m of mem) expect(pg).toContain(m);
  });
});
