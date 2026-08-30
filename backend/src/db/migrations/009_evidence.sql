-- Evidence-Items (Chain of Custody) — append-only Beweisstücke an einem Ticket.
-- Felder spiegeln die Evidence-Domain (src/domain/Evidence.js). Idempotent.

CREATE TABLE IF NOT EXISTS evidence (
  id              UUID PRIMARY KEY,
  ticket_id       TEXT NOT NULL DEFAULT '',
  payload_id      TEXT NULL,
  type            TEXT NOT NULL DEFAULT 'log_entry',
  source          TEXT NOT NULL DEFAULT 'manual',
  title           TEXT NOT NULL DEFAULT '',
  log_source      TEXT NOT NULL DEFAULT '',
  event_id        TEXT NOT NULL DEFAULT '',
  query           TEXT NOT NULL DEFAULT '',
  raw_text        TEXT NOT NULL DEFAULT '',
  event_timestamp TIMESTAMPTZ NULL,
  confidence      INTEGER NULL,
  comment         TEXT NOT NULL DEFAULT '',
  collected_by    TEXT NOT NULL DEFAULT '',
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_ticket  ON evidence(ticket_id);
CREATE INDEX IF NOT EXISTS idx_evidence_created ON evidence(created_at);

COMMENT ON TABLE evidence IS 'Append-only Evidence-Items (Chain of Custody) je Ticket';
