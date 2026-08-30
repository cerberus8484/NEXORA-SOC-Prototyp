-- Migration 005: Intake Events
-- Begrenzt und nachvollziehbar: eventId + contentHash für Idempotenz.
-- raw_ref zeigt auf unveränderlichen Speicher; das Raw-Payload selbst wird NICHT gespeichert.
-- Kein unbounded JSONB-Blob, keine unbounded Arrays.

CREATE TABLE IF NOT EXISTS intake_events (
    intake_id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID         NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
    collector_id             UUID         NOT NULL REFERENCES collectors (collector_id) ON DELETE RESTRICT,
    site_id                  UUID         NOT NULL REFERENCES sites (site_id) ON DELETE RESTRICT,
    event_id                 VARCHAR(36)  NOT NULL,   -- UUIDv4 vom Collector
    content_hash             VARCHAR(64)  NOT NULL CHECK (length(content_hash) = 64),
    schema_version           VARCHAR(10)  NOT NULL DEFAULT '1.0',
    status                   VARCHAR(20)  NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'rejected', 'duplicate')),
    received_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at             TIMESTAMPTZ,
    raw_ref                  VARCHAR(2000) NOT NULL,   -- Referenz auf unveränderlichen Raw-Speicher
    provenance_parser_name   VARCHAR(200) NOT NULL DEFAULT 'unknown',
    provenance_parser_version VARCHAR(50) NOT NULL,
    provenance_confidence    NUMERIC(3,2) NOT NULL CHECK (provenance_confidence BETWEEN 0 AND 1),
    provenance_warnings      TEXT[]       NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Idempotenz: gleiche eventId desselben Collectors nur einmal
    CONSTRAINT uq_intake_event_id_collector UNIQUE (event_id, collector_id),
    -- Inhalts-Duplikat: gleicher Hash desselben Collectors nur einmal
    CONSTRAINT uq_intake_content_hash_collector UNIQUE (content_hash, collector_id)
);

CREATE INDEX IF NOT EXISTS idx_intake_tenant_id    ON intake_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_intake_collector_id ON intake_events (collector_id);
CREATE INDEX IF NOT EXISTS idx_intake_status       ON intake_events (status);
CREATE INDEX IF NOT EXISTS idx_intake_received_at  ON intake_events (received_at DESC);
