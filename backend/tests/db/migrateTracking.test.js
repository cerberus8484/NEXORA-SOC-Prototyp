'use strict';

// migrate() mit Tracking-Tabelle: jede SQL-Datei läuft genau EINMAL.
// Gegen injizierte queryFn — kein echtes Postgres.

const fs = require('fs');
const path = require('path');
const { migrate } = require('../../src/db/pool');

const MIG_DIR = path.join(__dirname, '../../src/db/migrations');
const ALL = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

function recorder(appliedFilenames = []) {
  const applied = new Set(appliedFilenames);
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT filename FROM schema_migrations/.test(sql)) {
      return { rows: [...applied].map(f => ({ filename: f })) };
    }
    return { rows: [] };
  };
  queryFn.calls = calls;
  queryFn.insertedFiles = () => calls
    .filter(c => /INSERT INTO schema_migrations/.test(c.sql))
    .map(c => c.params[0]);
  return queryFn;
}

describe('migrate() — Tracking', () => {
  it('legt die Tracking-Tabelle an und fragt den Stand ab', async () => {
    const q = recorder();
    await migrate(q);
    expect(q.calls.some(c => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(c.sql))).toBe(true);
    expect(q.calls.some(c => /SELECT filename FROM schema_migrations/.test(c.sql))).toBe(true);
  });

  it('führt auf leerer DB alle Dateien EINMAL aus und erfasst sie', async () => {
    const q = recorder([]);
    await migrate(q);
    expect(q.insertedFiles().sort()).toEqual(ALL);
  });

  it('überspringt bereits getrackte Dateien (nur Neue laufen)', async () => {
    const q = recorder([ALL[0], ALL[1]]);
    await migrate(q);
    const ran = q.insertedFiles();
    expect(ran).not.toContain(ALL[0]);
    expect(ran).toContain(ALL[2]);
    expect(ran.length).toBe(ALL.length - 2);
  });

  it('ist no-op, wenn alle Dateien getrackt sind', async () => {
    const q = recorder(ALL);
    await migrate(q);
    expect(q.insertedFiles().length).toBe(0);
  });
});
