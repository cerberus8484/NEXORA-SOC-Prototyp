'use strict';

// Manuelles, idempotentes Admin-Seeding (Alternative/Ergänzung zum Startup-Bootstrap).
// Nutzung im Container:  node src/scripts/seedAdmin.js   (oder: npm run seed:admin)
// Liest ADMIN_EMAIL / ADMIN_PASSWORD aus der Umgebung. Loggt kein Passwort.

require('dotenv').config();

const config = require('../config');
const { ensureAdminFromEnv } = require('../services/bootstrapAdmin');

(async () => {
  try {
    if (config.db.enabled) {
      const { migrate } = require('../db/pool');
      await migrate();
    }
    const res = await ensureAdminFromEnv();

    if (res.skipped) {
      console.error('Übersprungen: ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt.');
      process.exit(1);
    }
    if (res.error) {
      console.error('Fehler beim Admin-Seeding:', res.error);
      process.exit(1);
    }
    console.log(res.created ? `Admin angelegt: ${res.email}` : `Admin existiert bereits: ${res.email}`);
    process.exit(0);
  } catch (err) {
    console.error('Seed fehlgeschlagen:', err.message);
    process.exit(1);
  }
})();
