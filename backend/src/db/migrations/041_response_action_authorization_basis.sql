-- Migration 041: Rechts-/Genehmigungsgrundlage fuer privilegierte Response-Aktionen.
-- authorization_basis = dokumentierte Befugnis bei der Genehmigung (z.B. Betriebsrat-
-- Zustimmung / Notfall-Freigabe). Governance-Nachweis, dass die privilegierte
-- Massnahme (z.B. Host-Isolation) befugt freigegeben wurde. Additiv/idempotent.
ALTER TABLE hunt_response_actions ADD COLUMN IF NOT EXISTS authorization_basis TEXT NOT NULL DEFAULT '';
