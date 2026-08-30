-- Migration 008: normalisierte Projektion + Quell-/Beobachtungszeit für die Fusion (ADR-035 §6).
-- Der Outbox-Worker (Cross-Domain-Fusion) braucht 5-Tuple/Severity/Bytes, Domäne (source.type)
-- und observedAt. Diese lagen bisher NICHT in intake_events (nur Metadaten + raw_ref).
--
-- WICHTIG: Das ist KEIN Raw-Payload. `normalized` ist die bereits VALIDIERTE, vom Contract
-- GRÖSSEN-GEDECKELTE Projektion (entities ≤50, feste Sub-Blöcke). Raw bleibt ausschließlich raw_ref.
-- Alle Spalten nullable → Bestandsdaten/alte Events bleiben gültig.

ALTER TABLE intake_events
    ADD COLUMN IF NOT EXISTS observed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_type      VARCHAR(40),   -- Domäne: ids | firewall | siem | …
    ADD COLUMN IF NOT EXISTS source_vendor    VARCHAR(60),
    ADD COLUMN IF NOT EXISTS source_instance  VARCHAR(120),
    ADD COLUMN IF NOT EXISTS normalized       JSONB;

-- Worker-Fusion fragt nach Domäne + Zeit; Index hält die Claim-/Fenster-Abfrage schlank.
CREATE INDEX IF NOT EXISTS idx_intake_source_type ON intake_events (source_type);
CREATE INDEX IF NOT EXISTS idx_intake_observed_at ON intake_events (observed_at);
