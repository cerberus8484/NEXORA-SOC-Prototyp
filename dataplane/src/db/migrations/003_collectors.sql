-- Migration 003: Collectors
-- tenantId ist denormalisiert für effiziente Tenant-Isolation-Checks.
-- Ein Collector gehört zu genau einer Site und damit zu genau einem Tenant.

CREATE TABLE IF NOT EXISTS collectors (
    collector_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id      UUID         NOT NULL REFERENCES sites (site_id) ON DELETE RESTRICT,
    tenant_id    UUID         NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
    name         VARCHAR(200) NOT NULL CHECK (length(trim(name)) > 0),
    type         VARCHAR(50)  NOT NULL
                 CHECK (type IN (
                     'opnsense_firewall',
                     'wazuh_agent',
                     'syslog_generic',
                     'network_sensor',
                     'custom'
                 )),
    status       VARCHAR(20)  NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked', 'suspended')),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT fk_collector_site_tenant
        CHECK (tenant_id IS NOT NULL AND site_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_collectors_site_id   ON collectors (site_id);
CREATE INDEX IF NOT EXISTS idx_collectors_tenant_id ON collectors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_collectors_status    ON collectors (status);
