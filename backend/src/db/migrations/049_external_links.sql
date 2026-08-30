-- Migration 049: external_links — restart-feste Outbound-Export-Dedup (#3a)
--
-- ExternalLink lag bisher nur InMemory → nach API-Neustart war die Dedup-Spur
-- (deduplicationKey = external_system::external_id) weg, ServiceNow/OTRS-Exporte
-- konnten doppelt rausgehen. Diese Tabelle persistiert den Beleg.
--
-- Spalten spiegeln das ExternalLink-Domänenobjekt. Der UNIQUE-Index auf
-- (external_system, external_id) ist der Dedup-Anker (== deduplicationKey).
-- Additiv + idempotent. KEINE Secrets (nur externe Ticket-IDs/URLs).

CREATE TABLE IF NOT EXISTS external_links (
  id                 UUID        PRIMARY KEY,
  internal_ticket_id TEXT        NOT NULL,
  external_system    TEXT        NOT NULL,
  external_id        TEXT        NOT NULL,
  external_url       TEXT        NOT NULL DEFAULT '',
  sync_direction     TEXT        NOT NULL DEFAULT 'inbound',
  sync_status        TEXT        NOT NULL DEFAULT 'pending',
  last_sync_at       TIMESTAMPTZ,
  last_sync_error    TEXT,
  raw_payload_hash   TEXT        NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup-Anker: ein Link je (System, externe ID). == ExternalLink.deduplicationKey.
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_links_dedup
  ON external_links (external_system, external_id);

-- Schneller Lookup aller Links eines internen Tickets (findByTicketId).
CREATE INDEX IF NOT EXISTS idx_external_links_internal_ticket_id
  ON external_links (internal_ticket_id);
