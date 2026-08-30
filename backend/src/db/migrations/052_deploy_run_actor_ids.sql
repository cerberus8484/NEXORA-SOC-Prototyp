-- Migration 052: Deployment Center — stabile Actor-IDs für die Vier-Augen-Prüfung.
--
-- Die Vier-Augen-Kontrolle (Ersteller ≠ Genehmiger) verglich bisher nur das Label
-- (E-Mail). E-Mail-Case-Varianz oder ein IdP-Wechsel könnten die Prüfung aushebeln.
-- Zusätzlich zur Label-Spalte wird nun die stabile User-ID (JWT `sub`) geführt und
-- bevorzugt verglichen. Additiv + idempotent.

ALTER TABLE deploy_runs ADD COLUMN IF NOT EXISTS started_by_id  TEXT;
ALTER TABLE deploy_runs ADD COLUMN IF NOT EXISTS approved_by_id TEXT;
