-- Migration 035: node_credentials (P_INSTALL_1 Slice 2)
-- Langlebiges, an die Node gebundenes Betriebs-Credential für Heartbeats.
-- **Es wird NUR der SHA-256-Hash gespeichert** — niemals der Klartext (der wird
-- genau einmal in der Enrollment-Response geliefert). Trennt Bootstrap
-- (Enrollment-Token, einmalig) vom Betrieb (NodeCredential).
-- Idempotenz: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS node_credentials (
  id             UUID        PRIMARY KEY,
  node_id        UUID        NOT NULL,
  token_hash     TEXT        NOT NULL UNIQUE,  -- SHA-256, nie Klartext
  prefix         TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'active',
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_node_credentials_hash    ON node_credentials (token_hash);
CREATE INDEX IF NOT EXISTS idx_node_credentials_node_id ON node_credentials (node_id);
