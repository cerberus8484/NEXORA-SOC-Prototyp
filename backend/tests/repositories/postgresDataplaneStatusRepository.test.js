'use strict';

// Postgres-Dataplane-Status-Repo gegen injizierte queryFn (kein echtes Postgres).
// Deckt _row-Mapping + JSONB-Handling im upsert ab (vorher ungetestet).

const { PostgresDataplaneStatusRepository } = require('../../src/repositories/PostgresDataplaneStatusRepository');

const ROW = {
  node_id: 'dp-1',
  reported_at: '2026-06-30T12:00:00.000Z',
  received_at: '2026-06-30T12:00:01.000Z',
  collectors: [{ name: 'cowrie', status: 'running' }],
  intake: { total: 5 },
  outbox: { pending: 1 },
  updated_at: '2026-06-30T12:00:01.000Z',
};

function fakeQuery(behavior = {}) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO dataplane_status/.test(sql)) return { rows: [behavior.upsert ?? ROW] };
    if (/WHERE node_id/.test(sql)) return { rows: 'get' in behavior ? (behavior.get ? [behavior.get] : []) : [ROW] };
    if (/ORDER BY node_id/.test(sql)) return { rows: behavior.list ?? [ROW] };
    return { rows: [] };
  };
  fn.calls = calls;
  return fn;
}

describe('PostgresDataplaneStatusRepository', () => {
  it('get mappt die DB-Zeile auf das Domänen-Objekt', async () => {
    const repo = new PostgresDataplaneStatusRepository({ queryFn: fakeQuery() });
    const got = await repo.get('dp-1');
    expect(got.nodeId).toBe('dp-1');
    expect(got.collectors[0].name).toBe('cowrie');
    expect(got.intake.total).toBe(5);
    expect(got.outbox.pending).toBe(1);
  });

  it('get liefert null bei unbekanntem Knoten', async () => {
    const repo = new PostgresDataplaneStatusRepository({ queryFn: fakeQuery({ get: null }) });
    expect(await repo.get('nope')).toBeNull();
  });

  it('list mappt alle Zeilen', async () => {
    const repo = new PostgresDataplaneStatusRepository({ queryFn: fakeQuery({ list: [ROW, { ...ROW, node_id: 'dp-2' }] }) });
    const list = await repo.list();
    expect(list.map((n) => n.nodeId)).toEqual(['dp-1', 'dp-2']);
  });

  it('upsert übergibt JSONB als String-Parameter ($3..$5) + RETURNING-Mapping', async () => {
    const q = fakeQuery();
    const repo = new PostgresDataplaneStatusRepository({ queryFn: q });
    await repo.upsert('dp-1', { reportedAt: 'x', collectors: [{ name: 'c', status: 'running' }], intake: { total: 9 }, outbox: { pending: 0 } });
    const call = q.calls.find((c) => /INSERT INTO dataplane_status/.test(c.sql));
    expect(call.params[0]).toBe('dp-1');
    expect(typeof call.params[2]).toBe('string'); // collectors JSON.stringify
    expect(JSON.parse(call.params[2])[0].name).toBe('c');
    expect(JSON.parse(call.params[3]).total).toBe(9); // intake
  });
});
