-- P5 Migration: Tickets-Tabelle
-- Bewusst pragmatisch: komplexe verschachtelte Objekte als JSONB
-- Normalisierung folgt wenn Suche/Reporting/Sync echte Anforderungen liefern

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- für gen_random_uuid()

CREATE TABLE IF NOT EXISTS tickets (
  -- Identifikation
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number    TEXT        NOT NULL DEFAULT '',
  offense_id       TEXT        NOT NULL DEFAULT '',
  title            TEXT        NOT NULL,
  category         TEXT        NOT NULL DEFAULT '',
  use_case         TEXT        NOT NULL DEFAULT '',

  -- Status & Klassifizierung
  priority         TEXT        NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('critical','high','medium','low','info')),
  status           TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','progress','closed','fp')),
  analyst          TEXT        NOT NULL DEFAULT '',
  source           TEXT        NOT NULL DEFAULT 'manual',
  occurred_at      TIMESTAMPTZ,

  -- Komplexe Domänen als JSONB (pragmatisch für P5)
  identity         JSONB       NOT NULL DEFAULT '{}',
  network          JSONB       NOT NULL DEFAULT '{}',
  asset            JSONB       NOT NULL DEFAULT '{}',
  analysis         JSONB       NOT NULL DEFAULT '{}',
  payloads         JSONB       NOT NULL DEFAULT '[]',
  evidence         JSONB       NOT NULL DEFAULT '[]',
  external_links   JSONB       NOT NULL DEFAULT '[]',

  -- Timestamps
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexe für häufige Queries
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority   ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_analyst    ON tickets(analyst);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at DESC);

-- Fulltext-Index auf title + analyst
CREATE INDEX IF NOT EXISTS idx_tickets_fulltext
  ON tickets USING gin(to_tsvector('english', title || ' ' || analyst || ' ' || ticket_number || ' ' || offense_id));

-- Automatisches updated_at via Trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_updated_at ON tickets;
CREATE TRIGGER tickets_set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tickets IS 'SOC Incident Tickets — P5 initiale Version mit JSONB für komplexe Felder';
