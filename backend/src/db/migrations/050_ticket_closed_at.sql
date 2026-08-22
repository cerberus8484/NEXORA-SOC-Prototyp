-- Migration 050: tickets.closed_at — echter Close-Zeitpunkt für korrekte MTTR (#1)
--
-- Bisher berechnete die MTTR (Mean Time To Resolve) aus (updated_at - created_at).
-- updated_at ändert sich aber bei JEDEM Edit (Notiz, Reassign, Payload …) → die
-- MTTR wurde bei jeder Nachbearbeitung eines geschlossenen Tickets verfälscht.
--
-- closed_at hält den Zeitpunkt fest, an dem ein Ticket in state=CLOSED überging,
-- und wird beim Re-Open (→ OPEN) wieder auf NULL gesetzt. Damit misst die MTTR
-- die tatsächliche Bearbeitungsdauer, unabhängig von späteren Edits.
--
-- Additiv + idempotent (ADD COLUMN IF NOT EXISTS). Kein Constraint (NULL erlaubt:
-- offene Tickets haben kein closed_at). Keine PII.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Backfill für Altbestand: für bereits geschlossene Tickets ist updated_at der
-- beste verfügbare Proxy des Close-Zeitpunkts (besser als NULL → sie zählen sonst
-- gar nicht mehr in die MTTR). Läuft nur beim ersten Mal scharf; danach sind alle
-- geschlossenen Tickets bereits gesetzt → No-Op.
UPDATE tickets SET closed_at = updated_at
 WHERE state = 'CLOSED' AND closed_at IS NULL;

-- Index für die MTTR-Aggregation (WHERE state='CLOSED' AND closed_at IS NOT NULL).
CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(closed_at) WHERE closed_at IS NOT NULL;

COMMENT ON COLUMN tickets.closed_at IS 'Zeitpunkt des Übergangs nach state=CLOSED; NULL wenn offen (echte MTTR-Basis, nicht updated_at)';
