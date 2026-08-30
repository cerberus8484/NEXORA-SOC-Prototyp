-- Migration 026: published_detections
-- SIEM-agnostischer Snapshot der Detection-Logik nach dem Publish-Übergang.
--
-- DSGVO-Hinweis:
--   Enthält KEINE testCases/Beispiel-Events — diese können rohe PII (IPs,
--   Hostnamen, User-IDs aus echten Incidents) enthalten (Art. 5 Abs. 1 lit. c,
--   Art. 32 DSGVO). Nur technische Detection-Logik (queryOrRule, explanation)
--   wird hier gespeichert.
--
-- Idempotenz: UNIQUE auf draft_id — jeder Draft kann nur einmal publiziert werden.

CREATE TABLE IF NOT EXISTS published_detections (
  id           UUID        PRIMARY KEY,
  draft_id     UUID        NOT NULL,
  title        TEXT        NOT NULL DEFAULT '',
  language     TEXT        NOT NULL DEFAULT 'generic',
  rule         TEXT        NOT NULL DEFAULT '',
  explanation  TEXT        NOT NULL DEFAULT '',
  mitre        JSONB       NOT NULL DEFAULT '[]',
  severity     TEXT        NOT NULL DEFAULT 'medium',
  source_type  TEXT        NOT NULL DEFAULT '',
  source_id    TEXT        NOT NULL DEFAULT '',
  published_by TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotenz-Index: Ein Draft → ein Detection-Eintrag (1:1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_published_detections_draft
  ON published_detections (draft_id);

-- Performance-Index für paginierte Abfragen (neueste zuerst)
CREATE INDEX IF NOT EXISTS idx_published_detections_created
  ON published_detections (created_at DESC);
