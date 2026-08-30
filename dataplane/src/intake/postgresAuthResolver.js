'use strict';

// Echte Collector-Credential-Auflösung (ersetzt den Dev-Stub mit EINEM Token für alle).
// Sicherheitsmodell: das eingehende `x-collector-credential` wird zu SHA-256 gehasht und
// gegen `collector_credentials.credential_hash` aufgelöst → Pro-Collector-Identität
// (collectorId/tenantId/siteId). Der Klartext wird NIE direkt verglichen → strukturell
// timing-sicher (Vergleich passiert über den Hash-Index, nicht byteweise in JS).
// Nur AKTIVE Credentials AKTIVER Collectors authentifizieren.
const crypto = require('node:crypto');

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * @param {{ pool: { query: Function } }} deps  Postgres-Pool (oder Fake mit query()).
 * @returns {(req:{get:Function}) => Promise<{collectorId,tenantId,siteId}|null>}
 */
function createCollectorAuthResolver({ pool } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('authResolver: pool required');

  return async function resolveAuth(req) {
    const cred = req && typeof req.get === 'function' ? req.get('x-collector-credential') : null;
    if (!cred) return null; // kein Header → keine DB-Abfrage

    const r = await pool.query(
      `SELECT cc.collector_id, cc.tenant_id, cc.site_id
         FROM collector_credentials cc
         JOIN collectors c ON c.collector_id = cc.collector_id
        WHERE cc.credential_hash = $1
          AND cc.status = 'active'
          AND c.status = 'active'
        LIMIT 1`,
      [sha256hex(cred)],
    );
    if (!r.rows || r.rows.length === 0) return null;
    const row = r.rows[0];
    return { collectorId: row.collector_id, tenantId: row.tenant_id, siteId: row.site_id };
  };
}

module.exports = { createCollectorAuthResolver, sha256hex };
