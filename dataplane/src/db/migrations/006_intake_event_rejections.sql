-- Migration 006: Intake Event Rejections
-- Auditierbare Ablehnung: jede Ablehnung wird aufgezeichnet.
-- safe_detail darf KEINE Secrets, PII, Raw-Payload-Fragmente oder Credential-Werte enthalten.
-- intake_id ist nullable: Ablehnung kann vor IntakeEvent-Erstellung erfolgen (z.B. Auth-Fehler).

CREATE TABLE IF NOT EXISTS intake_event_rejections (
    rejection_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id    UUID         REFERENCES intake_events (intake_id) ON DELETE SET NULL,
    collector_id UUID         NOT NULL REFERENCES collectors (collector_id) ON DELETE RESTRICT,
    tenant_id    UUID         NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
    site_id      UUID         NOT NULL REFERENCES sites (site_id) ON DELETE RESTRICT,
    reason       VARCHAR(50)  NOT NULL
                 CHECK (reason IN (
                     'validation_error',
                     'auth_failure',
                     'tenant_mismatch',
                     'duplicate',
                     'schema_invalid',
                     'payload_too_large',
                     'collector_revoked',
                     'missing_required_field',
                     'rate_limit'
                 )),
    safe_detail  VARCHAR(500) NOT NULL CHECK (length(trim(safe_detail)) > 0),
    rejected_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rejection_collector_id ON intake_event_rejections (collector_id);
CREATE INDEX IF NOT EXISTS idx_rejection_tenant_id    ON intake_event_rejections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rejection_reason       ON intake_event_rejections (reason);
CREATE INDEX IF NOT EXISTS idx_rejection_rejected_at  ON intake_event_rejections (rejected_at DESC);
