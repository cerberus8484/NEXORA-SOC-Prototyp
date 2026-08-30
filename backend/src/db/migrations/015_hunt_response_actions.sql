-- Response-Console Stufe 2: privilegierte Aktionen mit Genehmigungs-Gate.
-- Es wird NICHTS real ausgeführt (kein Agent) — nur Anfrage/Genehmigung + Audit.
CREATE TABLE IF NOT EXISTS hunt_response_actions (
  id               UUID PRIMARY KEY,
  hunt_session_id  UUID NOT NULL,
  target_host      TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL,                 -- isolate_host | release_isolation | privileged_command
  command          TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL DEFAULT '',
  risk_tier        TEXT NOT NULL DEFAULT 'privileged',  -- containment | privileged
  status           TEXT NOT NULL DEFAULT 'requested',   -- requested|approved|rejected|...
  requested_by     TEXT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_hunt_response_actions_session ON hunt_response_actions (hunt_session_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_hunt_response_actions_status  ON hunt_response_actions (status);
