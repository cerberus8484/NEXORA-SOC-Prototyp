-- Threat Hunt Operations Center: Hunt-Console-Logs + reiche Finding-Felder.
-- Additiv — bestehende hunt_*-Tabellen bleiben unverändert kompatibel.

-- Hunt-Console-Logzeilen (Runner-Ausgabe).
CREATE TABLE IF NOT EXISTS hunt_logs (
  id         UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0,
  level      TEXT NOT NULL DEFAULT 'info',     -- info | warning | error | success
  message    TEXT NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hunt_logs_session ON hunt_logs (session_id, seq);

-- Reiche Kontextfelder fürs Finding-Detail-Panel (host, user, process, pid,
-- commandLine, sourceIp, destinationIp, protocol, verdict, mitreTactic …).
ALTER TABLE hunt_findings ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Hunt-Runner-Metadaten auf der Session.
ALTER TABLE hunt_sessions ADD COLUMN IF NOT EXISTS hunt_type      TEXT NOT NULL DEFAULT '';
ALTER TABLE hunt_sessions ADD COLUMN IF NOT EXISTS title          TEXT NOT NULL DEFAULT '';
ALTER TABLE hunt_sessions ADD COLUMN IF NOT EXISTS risk_level     TEXT NOT NULL DEFAULT 'low';
ALTER TABLE hunt_sessions ADD COLUMN IF NOT EXISTS summary        TEXT NOT NULL DEFAULT '';
ALTER TABLE hunt_sessions ADD COLUMN IF NOT EXISTS findings_count INTEGER NOT NULL DEFAULT 0;
