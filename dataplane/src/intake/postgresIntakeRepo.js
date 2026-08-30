'use strict';

// Postgres-Intake-Repo — dauerhaft + Transactional Outbox (ADR-004).
// Gleiches Interface wie InMemory (has/save/get/count) → intakeService kennt nur das Interface.
// save(): intake_event + outbox-Eintrag ATOMAR in einer Transaktion (kein Event ohne Outbox).
// Idempotenz: UNIQUE(event_id, collector_id) → ON CONFLICT DO NOTHING (Race-Sicherheit).
//
// Erwartet `record` aus intakeService: { ...envelope, tenantId, collector:{collectorId,siteId}, receivedAt }.
// tenantId/collectorId/siteId sind UUIDs (FK auf tenants/collectors/sites).

function splitKey(key) {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)]; // collectorId:eventId (beide UUID, kein ':')
}

function createPostgresIntakeRepo(pool) {
  return {
    async has(key) {
      const [collectorId, eventId] = splitKey(key);
      const r = await pool.query(
        'SELECT 1 FROM intake_events WHERE collector_id = $1 AND event_id = $2 LIMIT 1',
        [collectorId, eventId],
      );
      return r.rowCount > 0;
    },

    async save(_key, record) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ins = await client.query(
          `INSERT INTO intake_events
             (tenant_id, collector_id, site_id, event_id, content_hash, schema_version, status,
              received_at, raw_ref, provenance_parser_name, provenance_parser_version,
              provenance_confidence, provenance_warnings,
              observed_at, source_type, source_vendor, source_instance, normalized)
           VALUES ($1,$2,$3,$4,$5,$6,'accepted',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT DO NOTHING
           RETURNING intake_id`,
          [
            record.tenantId,
            record.collector.collectorId,
            record.collector.siteId,
            record.eventId,
            record.raw.hash,
            record.schemaVersion || '1.0',
            record.receivedAt,
            record.raw.ref,
            (record.provenance && record.provenance.parserName) || 'unknown',
            record.provenance.parserVersion,
            record.provenance.confidence,
            (record.provenance && record.provenance.warnings) || [],
            record.observedAt || null,
            (record.source && record.source.type) || null,
            (record.source && record.source.vendor) || null,
            (record.source && record.source.instanceId) || null,
            // Bereits validierte, contract-gedeckelte Projektion (ADR-035 §6) — kein Raw-Payload.
            record.normalized ? JSON.stringify(record.normalized) : null,
          ],
        );
        if (ins.rowCount === 0) { await client.query('ROLLBACK'); return null; } // Duplikat (Race)
        const intakeId = ins.rows[0].intake_id;
        await client.query(
          `INSERT INTO intake_outbox (intake_event_id, tenant_id, site_id, collector_id)
           VALUES ($1, $2, $3, $4)`,
          [intakeId, record.tenantId, record.collector.siteId, record.collector.collectorId],
        );
        await client.query('COMMIT');
        return { intakeId };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async get(key) {
      const [collectorId, eventId] = splitKey(key);
      const r = await pool.query(
        'SELECT * FROM intake_events WHERE collector_id = $1 AND event_id = $2 LIMIT 1',
        [collectorId, eventId],
      );
      return r.rows[0] || null;
    },

    async count() {
      const r = await pool.query('SELECT count(*)::int AS n FROM intake_events');
      return r.rows[0].n;
    },
  };
}

module.exports = { createPostgresIntakeRepo };
