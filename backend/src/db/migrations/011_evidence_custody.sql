-- Chain-of-Custody-Events zu Evidence-Items (append-only Protokoll: viewed/reviewed/verified/flagged/note).
-- Review-Status wird daraus abgeleitet (kein mutabler Status am Evidence-Item → append-only bleibt). Idempotent.

CREATE TABLE IF NOT EXISTS evidence_custody (
  id          UUID PRIMARY KEY,
  evidence_id UUID NOT NULL,
  action      TEXT NOT NULL DEFAULT 'note',
  actor       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custody_evidence ON evidence_custody(evidence_id);

COMMENT ON TABLE evidence_custody IS 'Append-only Chain-of-Custody-Log je Evidence-Item';
