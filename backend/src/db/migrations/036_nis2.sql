-- Migration 036: NIS2 Readiness & Evidence (P_NIS2_1)
-- Arbeits-/Nachweis-Unterstützung (Readiness & Evidence) — KEIN Konformitäts-
-- nachweis. Speichert nur Assessment-/Evidence-Metadaten, NIE ein Secret/Token.
-- Control-Definitionen liegen statisch im Code (nis2ControlCatalog.js), nicht hier.
-- Idempotenz: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS nis2_assessments (
  id               UUID        PRIMARY KEY,
  control_key      TEXT        NOT NULL UNIQUE,   -- eine Bewertung je Control
  status           TEXT        NOT NULL DEFAULT 'not_started',
  owner            TEXT        NOT NULL DEFAULT '',
  due_date         TIMESTAMPTZ,
  notes            TEXT        NOT NULL DEFAULT '',
  last_reviewed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT        NOT NULL DEFAULT '',
  updated_by       TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_nis2_assessments_status ON nis2_assessments (status);

CREATE TABLE IF NOT EXISTS nis2_evidence_links (
  id            UUID        PRIMARY KEY,
  assessment_id UUID        NOT NULL REFERENCES nis2_assessments (id) ON DELETE CASCADE,
  evidence_type TEXT        NOT NULL,
  evidence_ref  TEXT        NOT NULL,   -- Referenz/URL — NIE ein Secret
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  captured_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_nis2_evidence_assessment ON nis2_evidence_links (assessment_id);
