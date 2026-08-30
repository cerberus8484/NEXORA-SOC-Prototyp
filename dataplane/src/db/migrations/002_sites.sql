-- Migration 002: Sites
-- Ein Site gehört zu genau einem Tenant. Collector-Bindung erfolgt über die Site.

CREATE TABLE IF NOT EXISTS sites (
    site_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
    name        VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
    location    VARCHAR(500),
    status      VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'deleted')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant_id ON sites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sites_status     ON sites (status);
