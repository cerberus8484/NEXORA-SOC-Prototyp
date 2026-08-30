-- Wazuh False-Positive-Ausnahmen (Stage 4): eigener Lifecycle + Idempotenz + Audit-Anker.
-- Scope (srcips/dstips/dstports/protocol/agentId/reason) wird als JSONB gespeichert.
-- Idempotent.

CREATE TABLE IF NOT EXISTS wazuh_fp_exceptions (
  id                UUID PRIMARY KEY,
  ticket_id         UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  parent_rule_id    TEXT NOT NULL DEFAULT '',
  generated_rule_id INTEGER NULL,
  scope_hash        TEXT NOT NULL DEFAULT '',
  scope             JSONB NOT NULL DEFAULT '{}'::jsonb,
  xml               TEXT NOT NULL DEFAULT '',
  file              TEXT NOT NULL DEFAULT 'soc_fp_exceptions.xml',
  status            TEXT NOT NULL DEFAULT 'draft',
  created_by        TEXT NOT NULL DEFAULT '',
  approved_by       TEXT NOT NULL DEFAULT '',
  before_hash       TEXT NOT NULL DEFAULT '',
  after_hash        TEXT NOT NULL DEFAULT '',
  last_error        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at        TIMESTAMPTZ NULL,
  reverted_at       TIMESTAMPTZ NULL,
  CONSTRAINT wazuh_fp_status_check
    CHECK (status IN ('draft','applied','restart_required','active','reverted','failed'))
);

CREATE INDEX IF NOT EXISTS idx_wazuh_fp_ticket ON wazuh_fp_exceptions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wazuh_fp_scope  ON wazuh_fp_exceptions(scope_hash);

COMMENT ON TABLE  wazuh_fp_exceptions IS 'Scoped Wazuh-FP-Ausnahmen mit Lifecycle (draft→restart_required→active/reverted/failed)';
COMMENT ON COLUMN wazuh_fp_exceptions.scope_hash IS 'Idempotenz-Schlüssel über Parent-Rule + src/dst/port/protocol/agent';
