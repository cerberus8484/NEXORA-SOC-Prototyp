-- Lab-FK-Seed: Stammdaten (tenant/site/collectors) + pro-Collector-Credentials,
-- damit der Postgres-Intake die Kollektoren über collector_credentials authentifiziert.
-- credential_hash = SHA-256(token) — via pgcrypto digest(). KEINE realen Secrets (Lab-Tokens).
-- Idempotent: ON CONFLICT DO NOTHING → mehrfaches Seeden ist gefahrlos.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO tenants (tenant_id, name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'lab-tenant')
ON CONFLICT DO NOTHING;

INSERT INTO sites (site_id, tenant_id, name) VALUES
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'lab-site')
ON CONFLICT DO NOTHING;

INSERT INTO collectors (collector_id, site_id, tenant_id, name, type) VALUES
    ('33333333-3333-3333-3333-333333330001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'lab-conntrack', 'network_sensor'),
    ('33333333-3333-3333-3333-333333330002', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'lab-suricata',  'network_sensor'),
    ('33333333-3333-3333-3333-333333330003', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'lab-opnsense',  'opnsense_firewall'),
    ('33333333-3333-3333-3333-333333330004', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'lab-wazuh',     'wazuh_agent')
ON CONFLICT DO NOTHING;

INSERT INTO collector_credentials (collector_id, tenant_id, site_id, credential_hash) VALUES
    ('33333333-3333-3333-3333-333333330001', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', encode(digest('lab-conntrack-token', 'sha256'), 'hex')),
    ('33333333-3333-3333-3333-333333330002', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', encode(digest('lab-suricata-token',  'sha256'), 'hex')),
    ('33333333-3333-3333-3333-333333330003', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', encode(digest('lab-opnsense-token',  'sha256'), 'hex')),
    ('33333333-3333-3333-3333-333333330004', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', encode(digest('lab-wazuh-token',     'sha256'), 'hex'))
ON CONFLICT (credential_hash) DO NOTHING;
