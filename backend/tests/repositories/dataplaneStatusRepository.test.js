'use strict';

const { InMemoryDataplaneStatusRepository } = require('../../src/repositories/InMemoryDataplaneStatusRepository');

describe('InMemoryDataplaneStatusRepository', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryDataplaneStatusRepository(); });

  test('get auf unbekannten Knoten → null', async () => {
    expect(await repo.get('nope')).toBeNull();
  });

  test('upsert legt an und get liefert Snapshot mit receivedAt', async () => {
    const snap = { reportedAt: '2026-06-30T12:00:00.000Z', collectors: [{ name: 'c', status: 'running' }], intake: { total: 1 }, outbox: { pending: 0 } };
    const saved = await repo.upsert('dp-1', snap);
    expect(saved.nodeId).toBe('dp-1');
    expect(saved.receivedAt).toBeTruthy();
    const got = await repo.get('dp-1');
    expect(got.collectors).toHaveLength(1);
    expect(got.intake.total).toBe(1);
  });

  test('upsert ersetzt vorhandenen Knoten (last known)', async () => {
    await repo.upsert('dp-1', { reportedAt: 'a', collectors: [{ name: 'old', status: 'running' }] });
    await repo.upsert('dp-1', { reportedAt: 'b', collectors: [] });
    const got = await repo.get('dp-1');
    expect(got.reportedAt).toBe('b');
    expect(got.collectors).toEqual([]);
    expect(await repo.list()).toHaveLength(1);
  });

  test('list liefert alle Knoten als Kopien', async () => {
    await repo.upsert('a', { reportedAt: 'x' });
    await repo.upsert('b', { reportedAt: 'y' });
    const list = await repo.list();
    expect(list.map((n) => n.nodeId).sort()).toEqual(['a', 'b']);
    list[0].nodeId = 'mutated';
    expect((await repo.get('a')).nodeId).toBe('a'); // Kopie, kein Leak
  });

  test('upsert ohne Felder ist robust (Defaults)', async () => {
    const saved = await repo.upsert('dp-x', {});
    expect(saved.collectors).toEqual([]);
    expect(saved.intake).toEqual({});
    expect(saved.outbox).toEqual({});
    expect(saved.reportedAt).toBeNull();
  });
});
