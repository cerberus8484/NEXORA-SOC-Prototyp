-- P19 Alpha: KI-Agent-Vorschläge mit Human-Approval-Workflow.
CREATE TABLE IF NOT EXISTS agent_suggestions (
  id            UUID PRIMARY KEY,
  ticket_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,                       -- triage | action | enrichment
  proposal      TEXT NOT NULL,
  rationale     TEXT,
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 0,     -- 0.000..1.000
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  created_by    TEXT NOT NULL DEFAULT 'agent',
  model         TEXT,
  reviewed_by   TEXT,
  review_reason TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_suggestions_status    ON agent_suggestions (status);
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_ticket_id ON agent_suggestions (ticket_id);
