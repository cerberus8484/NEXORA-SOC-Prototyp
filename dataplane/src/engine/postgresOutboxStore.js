'use strict';

// Postgres-Outbox-Store — konkrete Umsetzung des Store-Interfaces für den Outbox-Worker.
// Spiegelt `inMemoryOutboxStore` (claimBatch/markCompleted/markRetrying/markFailed).
//
// claimBatch: atomar `pending`/`retrying` (available_at ≤ now) claimen via
// `FOR UPDATE SKIP LOCKED` → status='processing' (mehrere Worker kollidieren nicht),
// und den Envelope aus intake_events (normalized + source + observed_at) rekonstruieren,
// damit die Fusion 5-Tuple/Severity/Domäne/Bytes hat.

function rowToEnvelope(r) {
  return {
    eventId: r.event_id,
    observedAt: r.observed_at ? new Date(r.observed_at).toISOString() : (r.received_at ? new Date(r.received_at).toISOString() : null),
    source: { type: r.source_type, vendor: r.source_vendor, instanceId: r.source_instance },
    provenance: { confidence: r.provenance_confidence != null ? Number(r.provenance_confidence) : null },
    normalized: r.normalized || {},
  };
}

const {
  parseCorrelationKey, correlationKey, ipPairKey,
  DEFAULT_WINDOW_MS, DEFAULT_NOISE_WINDOW_MS,
} = require('./crossDomainFusion');

function createPostgresOutboxStore(pool) {
  return {
    // Window-Re-Fusion: alle persistierten Events im Zeitfenster, deren IP einer des Paares
    // ist (grobe JSONB-Filterung) → exakter Abgleich über fusionKey() in JS. So fusioniert
    // der Worker die vollständige Fenstermenge, nicht nur den Claim-Batch (ADR-035).
    async loadWindowEnvelopes(key, opts = {}) {
      const parsed = parseCorrelationKey(key);
      if (!parsed) return [];
      // Attacker-Aggregation hat KEINEN Zeit-Bucket → keine sinnvolle (beschränkte)
      // Fenster-Query. Leere Menge → Worker fusioniert den Claim-Batch; die stabile
      // identityKey hält die incidentId trotzdem über Fenster hinweg konstant (Anti-Flood).
      if (parsed.mode === 'attacker') return [];
      const windowMs = parsed.mode === 'noise'
        ? (opts.noiseWindowMs || DEFAULT_NOISE_WINDOW_MS)
        : (opts.windowMs || DEFAULT_WINDOW_MS);
      // Guard-Band ±1 Fenster: holt auch grenz-straddelnde Events des Paares mit,
      // damit die Sliding-Session sie verketten kann (Slice 3).
      const start = new Date((parsed.bucket - 1) * windowMs).toISOString();
      const end = new Date((parsed.bucket + 2) * windowMs).toISOString();
      if (parsed.mode === 'noise') {
        const r = await pool.query(
          `SELECT event_id, observed_at, received_at, source_type, source_vendor,
                  source_instance, provenance_confidence, normalized
             FROM intake_events
            WHERE observed_at >= $1 AND observed_at < $2
              AND source_type = $3
              AND COALESCE(source_vendor, '') = $4
              AND normalized->'network'->>'dstIp' = $5`,
          [start, end, parsed.sourceType, parsed.vendor, parsed.dstIp],
        );
        return r.rows.map(rowToEnvelope).filter((env) => correlationKey(env, opts) === key);
      }
      const r = await pool.query(
        `SELECT event_id, observed_at, received_at, source_type, source_vendor,
                source_instance, provenance_confidence, normalized
           FROM intake_events
          WHERE observed_at >= $2 AND observed_at < $3
            AND ( normalized->'network'->>'srcIp' = ANY($1)
               OR normalized->'network'->>'dstIp' = ANY($1)
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(normalized->'entities', '[]'::jsonb)) e
                           WHERE e->>'value' = ANY($1)) )`,
        [parsed.ips, start, end],
      );
      // Exakter IP-Paar-Abgleich (Bucket-unabhängig) — die Session-Bildung macht der Worker.
      const pair = parsed.ips.slice().sort().join('|');
      return r.rows.map(rowToEnvelope).filter((env) => ipPairKey(env) === pair);
    },

    async claimBatch({ limit = 100, workerId = 'worker', now } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Claimbare Outbox-Zeilen sperren (SKIP LOCKED) und auf processing setzen.
        const claimed = await client.query(
          `UPDATE intake_outbox o
              SET status = 'processing', claimed_at = now(), claimed_by = $2
            WHERE o.id IN (
                  SELECT id FROM intake_outbox
                   WHERE status IN ('pending','retrying')
                     AND available_at <= COALESCE($3::timestamptz, now())
                   ORDER BY available_at
                   FOR UPDATE SKIP LOCKED
                   LIMIT $1)
          RETURNING o.id, o.intake_event_id, o.attempt_count`,
          [limit, workerId, now || null],
        );
        if (claimed.rowCount === 0) { await client.query('COMMIT'); return []; }

        const intakeIds = claimed.rows.map((r) => r.intake_event_id);
        const events = await client.query(
          `SELECT intake_id, event_id, observed_at, received_at, source_type, source_vendor,
                  source_instance, provenance_confidence, normalized
             FROM intake_events WHERE intake_id = ANY($1)`,
          [intakeIds],
        );
        const byIntake = new Map(events.rows.map((r) => [r.intake_id, r]));
        await client.query('COMMIT');

        return claimed.rows.map((c) => ({
          outboxId: c.id,
          attemptCount: c.attempt_count,
          envelope: rowToEnvelope(byIntake.get(c.intake_event_id) || {}),
        }));
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async markCompleted(ids) {
      if (!ids.length) return;
      await pool.query(
        `UPDATE intake_outbox SET status='completed', completed_at=now(), updated_at=now(), failure_reason=NULL
          WHERE id = ANY($1)`, [ids]);
    },

    async markRetrying(ids, { reason, availableAt }) {
      if (!ids.length) return;
      await pool.query(
        `UPDATE intake_outbox
            SET status='retrying', attempt_count = attempt_count + 1,
                available_at = $2, failure_reason = $3, updated_at = now()
          WHERE id = ANY($1)`, [ids, availableAt, reason]);
    },

    async markFailed(ids, { reason }) {
      if (!ids.length) return;
      await pool.query(
        `UPDATE intake_outbox
            SET status='failed', attempt_count = attempt_count + 1,
                failure_reason = $2, updated_at = now()
          WHERE id = ANY($1)`, [ids, reason]);
    },
  };
}

module.exports = { createPostgresOutboxStore, rowToEnvelope };
