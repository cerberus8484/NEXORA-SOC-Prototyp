-- Migration 045: Worker-Live-Status (P_CORR_ADMIN_2 Stufe 3 — Live Health Confirmation)
--
-- Persistenter Nachweis, dass der Correlation-Worker lebt, die erwartete Runtime-
-- Config-Version übernommen hat und die Queue weiter verarbeitet. Ersetzt den
-- konservativen Health-Seam aus Stufe 2 durch echte, prüfbare Live-Signale.
--
-- adopted_config_versions ist eine Map {capabilityId: version} — die zwei apply-
-- eligible Worker-Caps haben unabhängige Versionen. Die Version wird NUR an einer
-- Job-Grenze (oder im idle-Heartbeat, wenn kein Job läuft) übernommen und erst
-- danach gemeldet; laufende Jobs behalten ihren Snapshot.
--
-- Additiv + idempotent. KEINE Secrets/PII.

CREATE TABLE IF NOT EXISTS worker_status (
  worker_id               TEXT        PRIMARY KEY,
  last_heartbeat_at       TIMESTAMPTZ,
  adopted_config_versions JSONB       NOT NULL DEFAULT '{}',
  last_job_started_at     TIMESTAMPTZ,
  last_job_completed_at   TIMESTAMPTZ,
  last_job_outcome        TEXT,
  queue_processing_state  TEXT        NOT NULL DEFAULT 'unknown', -- processing|idle|stalled|error|unknown
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
