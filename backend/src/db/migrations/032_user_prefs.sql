-- Migration 032: Self-Service-Präferenzen — language + dateFormat als persistente Felder
-- Beide Felder: NOT NULL mit sinnvollen Defaults — bestehende Rows erhalten 'de'/'dmy' ohne Datenverlust.
-- Idempotent via ADD COLUMN IF NOT EXISTS (Re-Run-sicher).
ALTER TABLE users ADD COLUMN IF NOT EXISTS language    TEXT NOT NULL DEFAULT 'de';
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'dmy';
