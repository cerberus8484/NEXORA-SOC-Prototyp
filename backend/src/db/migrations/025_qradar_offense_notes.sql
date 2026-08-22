-- Migration 025: QRadar Offense Notes
-- Analyst-Freitext-Notizen zu einer QRadar-Offense, keyed by offense_id.
-- DSGVO: content ist Freitext (potenziell personenbezogen) — Zugriff nur via API mit Auth.

CREATE TABLE IF NOT EXISTS qradar_offense_notes (
  id         UUID        PRIMARY KEY,
  offense_id TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  author     TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qradar_offense_notes_offense
  ON qradar_offense_notes (offense_id, created_at);
