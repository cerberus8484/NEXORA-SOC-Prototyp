-- Migration 033: provisioning (P_PROVISION_2)
-- Persistenz für das Provisioning-Domain-Model (P_PROVISION_1).
-- REIN Zustand: keine Apply-/Netzwerk-/Remote-Spalten. KEINE Klartext-Secrets
-- (keine token/password/secret-Spalten) — Tokens kommen später aus dem Backend.
-- Idempotenz: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS provisioning_profiles (
  id          UUID        PRIMARY KEY,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  labels      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT        NOT NULL DEFAULT 'draft',
  created_by  TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provisioning_profiles_status ON provisioning_profiles (status);
CREATE INDEX IF NOT EXISTS idx_provisioning_profiles_role   ON provisioning_profiles (role);

CREATE TABLE IF NOT EXISTS enrollment_profiles (
  id            UUID        PRIMARY KEY,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL,
  capabilities  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  expires_at    TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrollment_profiles_status ON enrollment_profiles (status);

CREATE TABLE IF NOT EXISTS installed_nodes (
  id            UUID        PRIMARY KEY,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL,
  profile_id    UUID,
  fqdn          TEXT,
  ip            TEXT,
  os            TEXT,
  version       TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending',
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installed_nodes_status     ON installed_nodes (status);
CREATE INDEX IF NOT EXISTS idx_installed_nodes_profile_id ON installed_nodes (profile_id);

CREATE TABLE IF NOT EXISTS node_capabilities (
  id           UUID        PRIMARY KEY,
  node_id      UUID        NOT NULL,
  name         TEXT        NOT NULL,
  detail       JSONB,
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_node_capabilities_node_id ON node_capabilities (node_id);

CREATE TABLE IF NOT EXISTS node_heartbeats (
  id             UUID        PRIMARY KEY,
  node_id        UUID        NOT NULL,
  status         TEXT        NOT NULL,
  agent_version  TEXT,
  note           TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_node_heartbeats_node_id     ON node_heartbeats (node_id);
CREATE INDEX IF NOT EXISTS idx_node_heartbeats_node_recent ON node_heartbeats (node_id, received_at DESC);

CREATE TABLE IF NOT EXISTS provisioning_audit_events (
  id            UUID        PRIMARY KEY,
  type          TEXT        NOT NULL,
  actor         TEXT,
  subject_type  TEXT        NOT NULL,
  subject_id    TEXT,
  data          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provisioning_audit_subject ON provisioning_audit_events (subject_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_audit_type    ON provisioning_audit_events (type);
CREATE INDEX IF NOT EXISTS idx_provisioning_audit_at      ON provisioning_audit_events (at DESC);

-- Append-only auf DB-Ebene: UPDATE/DELETE am Audit blockieren (Beweissicherheit).
CREATE OR REPLACE FUNCTION provisioning_audit_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'provisioning_audit_events ist append-only (% nicht erlaubt)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provisioning_audit_append_only ON provisioning_audit_events;
CREATE TRIGGER trg_provisioning_audit_append_only
  BEFORE UPDATE OR DELETE ON provisioning_audit_events
  FOR EACH ROW EXECUTE FUNCTION provisioning_audit_block_mutation();
