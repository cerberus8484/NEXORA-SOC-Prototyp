-- Migration 032: Self-Service-Präferenzen — language + dateFormat als persistente Felder
-- Both fields are NOT NULL with sensible defaults for new rows.
-- Idempotent via ADD COLUMN IF NOT EXISTS (Re-Run-sicher).
ALTER TABLE users ADD COLUMN IF NOT EXISTS language    TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'dmy';
