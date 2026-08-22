'use strict';

const { SystemStatsService } = require('../src/services/SystemStatsService');

function fakeQuery(responses) {
  let i = 0;
  return async () => responses[i++];
}

describe('SystemStatsService', () => {
  test('dbEnabled=false → kein DB-Zugriff', async () => {
    const svc = new SystemStatsService({ dbEnabled: false, query: async () => { throw new Error('darf nicht aufgerufen werden'); } });
    expect(await svc.getStats()).toEqual({ dbEnabled: false });
  });

  test('aggregiert Counts + Verteilung + Speicher + Aktivität', async () => {
    const query = fakeQuery([
      { rows: [{ tickets: 251, tickets_open: 248, evidence: 6, hunts: 3, findings: 4, audit_24h: 12, fp_exceptions: 2, users: 1 }] },
      { rows: [{ priority: 'critical', n: 28 }, { priority: 'high', n: 51 }, { priority: 'medium', n: 177 }] },
      { rows: [{ state: 'OPEN', n: 248 }, { state: 'CLOSED', n: 3 }] },
      { rows: [{ bytes: '34359738368' }] },
      { rows: [{ name: 'audit_log', bytes: '20000000' }, { name: 'tickets', bytes: '5000000' }] },
      { rows: [{ day: '2026-06-12', n: 58867 }, { day: '2026-06-13', n: 1200 }] },
    ]);
    const stats = await new SystemStatsService({
      query,
      dbEnabled: true,
      poolSnapshot: () => ({ total: 8, idle: 3, waiting: 1, max: 10 }),
    }).getStats();
    expect(stats.counts).toEqual({ tickets: 251, ticketsOpen: 248, evidence: 6, hunts: 3, findings: 4, audit24h: 12, fpExceptions: 2, users: 1 });
    expect(stats.byPriority).toEqual({ critical: 28, high: 51, medium: 177 });
    expect(stats.storage.dbBytes).toBe(34359738368);
    expect(stats.storage.tables[0]).toEqual({ name: 'audit_log', bytes: 20000000 });
    expect(stats.activity).toEqual([{ day: '2026-06-12', writes: 58867 }, { day: '2026-06-13', writes: 1200 }]);
    expect(stats.pool).toEqual({ total: 8, idle: 3, waiting: 1, max: 10, saturated: true });
  });

  test('leere DB → Nullen, kein Crash', async () => {
    const query = fakeQuery([{ rows: [{}] }, { rows: [] }, { rows: [] }, { rows: [{}] }, { rows: [] }, { rows: [] }]);
    const stats = await new SystemStatsService({ query, dbEnabled: true }).getStats();
    expect(stats.counts.tickets).toBe(0);
    expect(stats.byPriority).toEqual({});
    expect(stats.storage.dbBytes).toBe(0);
    expect(stats.activity).toEqual([]);
    expect(stats.pool).toBeNull();
  });
});
