-- Migration 028: Profil-Self-Service — phone + theme als persistente Felder
-- Beide Felder: NOT NULL DEFAULT '' — bestehende Rows erhalten leere Strings ohne Datenverlust.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT '';
