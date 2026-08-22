-- Migration 042: Asynchrone, materialisierte Korrelation (P_CORR_1a)
--
-- Korrelation läuft nicht mehr schwer-synchron beim Ticket-Öffnen, sondern als
-- persistenter Job → Worker → materialisiertes Result, das die UI nur noch liest:
--   Ticket/Evidence/Flow geändert → correlation_jobs → Worker → correlation_results.
--
-- Speichert nur Korrelations-Metadaten + das Ergebnis-JSON; KEINE Secrets/Tokens.
-- Additiv + idempotent: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS correlation_jobs (
  id               UUID        PRIMARY KEY,
  ticket_id        TEXT        NOT NULL,
  input_hash       TEXT        NOT NULL,   -- Idempotenz-Schlüssel (Ticket + Revision + Engine-Version)
  source_revision  TEXT        NOT NULL,   -- Revision der Eingabe (Result nur gültig solange unverändert)
  engine_version   TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|completed|retrying|failed
  retry_count      INTEGER     NOT NULL DEFAULT 0,
  failure_reason   TEXT,
  result_reference UUID,                   -- → correlation_results.id, wenn completed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

-- DB-Idempotenz-Backstop: höchstens EIN AKTIVER Job je input_hash. Ein konkurrierender
-- Insert eines zweiten aktiven Jobs mit gleichem Input scheitert am Unique-Index
-- (gleicher Input erzeugt keinen Doppeljob — auch bei Races).
CREATE UNIQUE INDEX IF NOT EXISTS uq_correlation_jobs_active_input
  ON correlation_jobs (input_hash)
  WHERE status IN ('pending', 'running', 'retrying');

CREATE INDEX IF NOT EXISTS idx_correlation_jobs_ticket ON correlation_jobs (ticket_id);
CREATE INDEX IF NOT EXISTS idx_correlation_jobs_status ON correlation_jobs (status);

CREATE TABLE IF NOT EXISTS correlation_results (
  id              UUID        PRIMARY KEY,
  ticket_id       TEXT        NOT NULL,
  job_id          UUID,
  input_hash      TEXT        NOT NULL,
  source_revision TEXT        NOT NULL,
  engine_version  TEXT        NOT NULL,
  result          JSONB       NOT NULL,   -- materialisierte korrelierte Evidence
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_correlation_results_ticket ON correlation_results (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correlation_results_input  ON correlation_results (input_hash);

-- Vollständiger Rückverweis: welche Quell-Tickets (+ optional Evidence-Item) trugen bei.
CREATE TABLE IF NOT EXISTS correlation_result_evidence (
  id          UUID PRIMARY KEY,
  result_id   UUID NOT NULL REFERENCES correlation_results (id) ON DELETE CASCADE,
  ticket_id   TEXT NOT NULL,
  role        TEXT NOT NULL,             -- subject|parent|child
  evidence_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_correlation_result_evidence_result ON correlation_result_evidence (result_id);
