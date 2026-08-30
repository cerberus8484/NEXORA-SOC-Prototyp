-- Migration 004: Collector Credentials
-- Nur der SHA-256-Hash des Credentials wird gespeichert. Klartext niemals.
-- Eine Revoke setzt revoked_at und status='revoked' — der Hash bleibt für Audit-Zwecke.
-- credential_hash ist UNIQUE: kein Credential-Reuse möglich.

CREATE TABLE IF NOT EXISTS collector_credentials (
    credential_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collector_id    UUID         NOT NULL REFERENCES collectors (collector_id) ON DELETE RESTRICT,
    tenant_id       UUID         NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
    site_id         UUID         NOT NULL REFERENCES sites (site_id) ON DELETE RESTRICT,
    credential_hash VARCHAR(64)  NOT NULL UNIQUE CHECK (length(credential_hash) = 64),
    status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked')),
    issued_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cred_collector_id    ON collector_credentials (collector_id);
CREATE INDEX IF NOT EXISTS idx_cred_tenant_id       ON collector_credentials (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cred_status          ON collector_credentials (status);
-- Credential lookup by hash ist der primäre Auth-Pfad:
CREATE INDEX IF NOT EXISTS idx_cred_hash            ON collector_credentials (credential_hash);
