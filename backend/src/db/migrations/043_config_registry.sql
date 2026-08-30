-- Migration 043: Configuration Capability Registry (P_CONFIG_1 Slice 1)
--
-- Kontrollierter Konfigurations-Lifecycle: typisiertes Formular → Validierung →
-- Draft → Risiko → Approval → Audit. KEIN Apply/Reload/Restart in Slice 1.
-- Speichert nur Lifecycle-Zustand + redigierte Werte. KEINE Secrets/Tokens.
-- Capabilities/Targets selbst sind eine Code-Allowlist (configCapabilityCatalog),
-- NICHT in der DB — kein freier Key/JSON/Pfad. Additiv + idempotent.

CREATE TABLE IF NOT EXISTS config_drafts (
  id            UUID        PRIMARY KEY,
  capability_id TEXT        NOT NULL,   -- muss in der Code-Allowlist liegen (Service prüft)
  target_id     TEXT        NOT NULL,
  value         JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'draft',  -- draft|pending_approval|approved|rejected
  version       INTEGER     NOT NULL DEFAULT 1,        -- Optimistic Lock
  revision      INTEGER     NOT NULL DEFAULT 1,
  created_by    TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_config_drafts_capability ON config_drafts (capability_id);
CREATE INDEX IF NOT EXISTS idx_config_drafts_status     ON config_drafts (status);

CREATE TABLE IF NOT EXISTS config_draft_revisions (
  id         UUID        PRIMARY KEY,
  draft_id   UUID        NOT NULL REFERENCES config_drafts (id) ON DELETE CASCADE,
  revision   INTEGER     NOT NULL,
  value      JSONB       NOT NULL DEFAULT '{}',
  created_by TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_config_draft_revisions_draft ON config_draft_revisions (draft_id);

CREATE TABLE IF NOT EXISTS config_approvals (
  id         UUID        PRIMARY KEY,
  draft_id   UUID        NOT NULL REFERENCES config_drafts (id) ON DELETE CASCADE,
  decision   TEXT        NOT NULL,   -- approved|rejected  (approved ≠ applied!)
  decided_by TEXT        NOT NULL DEFAULT '',
  note       TEXT        NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_config_approvals_draft ON config_approvals (draft_id);

-- Append-only Audit mit redigiertem Vorher/Nachher-Diff (kein Secret im Klartext).
CREATE TABLE IF NOT EXISTS config_change_audit (
  id              UUID        PRIMARY KEY,
  type            TEXT        NOT NULL,
  actor           TEXT,
  capability_id   TEXT        NOT NULL,
  target_id       TEXT,
  draft_id        UUID,
  before_redacted JSONB,
  after_redacted  JSONB,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_config_change_audit_draft ON config_change_audit (draft_id);
CREATE INDEX IF NOT EXISTS idx_config_change_audit_at    ON config_change_audit (at DESC);
