-- Migration 007: Intake Outbox (Transactional Outbox Pattern)
-- Jeder akzeptierte IntakeEvent bekommt genau einen Outbox-Eintrag.
-- Beide entstehen atomar in derselben DB-Transaktion (kein Event ohne Outbox, kein Outbox ohne Event).
-- failure_reason: nur sichere Fehlercodes — NIE Payload, Stack-Traces oder PII.

CREATE TABLE IF NOT EXISTS intake_outbox (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_event_id  UUID          NOT NULL REFERENCES intake_events (intake_id) ON DELETE RESTRICT,
    tenant_id        UUID          NOT NULL REFERENCES tenants (tenant_id)       ON DELETE RESTRICT,
    site_id          UUID          NOT NULL REFERENCES sites (site_id)           ON DELETE RESTRICT,
    collector_id     UUID          NOT NULL REFERENCES collectors (collector_id) ON DELETE RESTRICT,

    status           VARCHAR(20)   NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'completed', 'retrying', 'failed')),

    attempt_count    INTEGER       NOT NULL DEFAULT 0
                     CHECK (attempt_count >= 0),

    -- available_at: Worker darf frühestens ab diesem Zeitpunkt claimen (für Backoff)
    available_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

    claimed_at       TIMESTAMPTZ,
    claimed_by       VARCHAR(200),   -- Worker-ID; kein Hostname/IP/Token
    completed_at     TIMESTAMPTZ,

    -- Nur sichere Fehlercodes: 'processor_error', 'timeout', 'validation_failed', etc.
    -- NIE: Stack-Trace, Event-Inhalt, Credentials, PII
    failure_reason   VARCHAR(500),

    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Genau ein Outbox-Eintrag pro IntakeEvent
    CONSTRAINT uq_outbox_intake_event UNIQUE (intake_event_id)
);

-- Index für Worker-Claim-Query: pending/retrying, nach available_at sortiert
CREATE INDEX IF NOT EXISTS idx_outbox_claimable
    ON intake_outbox (status, available_at)
    WHERE status IN ('pending', 'retrying');

-- Index für Stats-Query
CREATE INDEX IF NOT EXISTS idx_outbox_status
    ON intake_outbox (status);

CREATE INDEX IF NOT EXISTS idx_outbox_tenant_id
    ON intake_outbox (tenant_id);
