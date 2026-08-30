-- P13.DB Migration: Threat Hunting Persistenz
-- Sessions, Commands, Artifacts, Findings, Notes, Ticket-Links
-- Pragmatisch: metadata + artifact_ids als JSONB, Rest flach für Filter/Index.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ── Sessions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID,                          -- optional: verknüpftes Ticket
  analyst_id   TEXT        NOT NULL,
  target_host  TEXT        NOT NULL,
  scope        TEXT        NOT NULL DEFAULT '',
  hypothesis   TEXT        NOT NULL DEFAULT '',
  status       TEXT        NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','active','completed','failed','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hunt_sessions_ticket  ON hunt_sessions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_hunt_sessions_analyst ON hunt_sessions(analyst_id);
CREATE INDEX IF NOT EXISTS idx_hunt_sessions_status  ON hunt_sessions(status);
CREATE INDEX IF NOT EXISTS idx_hunt_sessions_created ON hunt_sessions(created_at DESC);

-- ── Commands ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_commands (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL
                 CHECK (type IN ('manual','osquery','yara','sigma','powershell','bash','log_search','network_scan')),
  command        TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','completed','failed','blocked')),
  result         TEXT        NOT NULL DEFAULT '',
  stdout         TEXT        NOT NULL DEFAULT '',
  stderr         TEXT        NOT NULL DEFAULT '',
  exit_code      INTEGER,
  blocked_reason TEXT        NOT NULL DEFAULT '',
  analyst_id     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at    TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hunt_commands_session ON hunt_commands(session_id);
CREATE INDEX IF NOT EXISTS idx_hunt_commands_status  ON hunt_commands(status);

-- ── Artifacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_artifacts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  command_id  UUID,                           -- optional: erzeugender Command
  type        TEXT        NOT NULL
              CHECK (type IN ('file','process','network_conn','registry_key','user_account','log_entry','ioc','memory_region','other')),
  value       TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  source      TEXT        NOT NULL DEFAULT '',
  analyst_id  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hunt_artifacts_session ON hunt_artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_hunt_artifacts_command ON hunt_artifacts(command_id);

-- ── Findings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_findings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  severity       TEXT        NOT NULL
                 CHECK (severity IN ('critical','high','medium','low','info')),
  confidence     TEXT        NOT NULL DEFAULT 'medium'
                 CHECK (confidence IN ('high','medium','low')),
  artifact_ids   JSONB       NOT NULL DEFAULT '[]',
  mitre_attack   TEXT        NOT NULL DEFAULT '',
  recommendation TEXT        NOT NULL DEFAULT '',
  analyst_id     TEXT        NOT NULL,
  ticket_id      UUID,                         -- gesetzt bei P13.4-Link
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hunt_findings_session ON hunt_findings(session_id);
CREATE INDEX IF NOT EXISTS idx_hunt_findings_ticket  ON hunt_findings(ticket_id);

-- ── Notes ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  analyst_id  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hunt_notes_session ON hunt_notes(session_id);

-- ── Ticket-Links (P13.4) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hunt_ticket_links (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_session_id   UUID        NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  ticket_id         UUID        NOT NULL,
  source_type       TEXT        NOT NULL
                    CHECK (source_type IN ('finding','artifact','summary')),
  source_id         TEXT        NOT NULL,
  summary           TEXT        NOT NULL DEFAULT '',
  linked_by         TEXT        NOT NULL,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deduplication_key TEXT        NOT NULL UNIQUE   -- Idempotenz auf DB-Ebene
);

CREATE INDEX IF NOT EXISTS idx_hunt_ticket_links_session ON hunt_ticket_links(hunt_session_id);
CREATE INDEX IF NOT EXISTS idx_hunt_ticket_links_ticket  ON hunt_ticket_links(ticket_id);

-- Automatisches updated_at (Trigger-Funktion set_updated_at existiert aus Migration 001)
DROP TRIGGER IF EXISTS hunt_sessions_set_updated_at ON hunt_sessions;
CREATE TRIGGER hunt_sessions_set_updated_at
  BEFORE UPDATE ON hunt_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS hunt_commands_set_updated_at ON hunt_commands;
CREATE TRIGGER hunt_commands_set_updated_at
  BEFORE UPDATE ON hunt_commands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS hunt_findings_set_updated_at ON hunt_findings;
CREATE TRIGGER hunt_findings_set_updated_at
  BEFORE UPDATE ON hunt_findings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE hunt_sessions     IS 'Threat Hunt Sessions — P13.DB';
COMMENT ON TABLE hunt_commands     IS 'Hunt Commands (Console-Modell, keine Remote-Execution) — P13.DB';
COMMENT ON TABLE hunt_artifacts    IS 'Hunt Artifacts — P13.DB';
COMMENT ON TABLE hunt_findings     IS 'Hunt Findings — P13.DB';
COMMENT ON TABLE hunt_notes        IS 'Hunt Analyst Notes — P13.DB';
COMMENT ON TABLE hunt_ticket_links IS 'Hunt→Ticket Traceability-Links — P13.4/P13.DB';
