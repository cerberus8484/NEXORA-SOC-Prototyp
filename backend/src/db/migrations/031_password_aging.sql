-- 031_password_aging.sql — Passwort-Aging (Welle 2)
-- Zwei additive Spalten auf users:
--   password_changed_at: Zeitpunkt der letzten Passwortänderung (für Ablauf)
--   password_history:    JSONB-Array alter bcrypt-Hashes (neueste zuerst) für Wiederverwendungssperre
-- Idempotent (IF NOT EXISTS), kein Datenverlust.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_history     JSONB NOT NULL DEFAULT '[]'::jsonb;
