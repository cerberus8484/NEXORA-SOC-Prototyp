'use strict';

// Migrations-Runner: führt alle *.sql in migrations/ in lexikalischer Reihenfolge aus.
// Idempotent (alle Migrationen nutzen IF NOT EXISTS). Beim Boot des Intake-Servers aufrufbar.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

async function runMigrations(connectionString, dir = path.join(__dirname, 'migrations')) {
  const pool = new Pool({ connectionString });
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    return files;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATAPLANE_DB_URL;
  if (!url) { console.error('DATAPLANE_DB_URL required'); process.exit(1); }
  runMigrations(url)
    .then((f) => { console.log(JSON.stringify({ msg: 'migrated', count: f.length, files: f })); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { runMigrations };
