-- Block 1 (Analysis): State + Status-Neumodell für Tickets
--
-- Neues Modell:
--   state        ∈ {OPEN, CLOSED}                                    (Lifecycle — eigenes Feld)
--   status       ∈ {assigned, in_progress, on_hold, awaiting_customer} (Workflow innerhalb OPEN)
--   close_reason ∈ {'', resolved, false_positive, duplicate, benign, other}
--
-- 'False Positive' ist jetzt ein SCHLIESSGRUND (close_reason), kein Status mehr.
--
-- WICHTIG: migrate() führt jede .sql bei JEDEM Start aus → diese Migration ist
-- idempotent (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS vor ADD,
-- UPDATEs matchen nach erstem Lauf keine alten Werte mehr).

-- 1. Neue Spalten
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS state        TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS close_reason TEXT NOT NULL DEFAULT '';

-- 2. Alten Status-Constraint lösen, damit Bestandsdaten umgeschrieben werden können
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;

-- 3. Bestandsdaten migrieren (Reihenfolge wichtig: erst state/reason aus altem status,
--    DANN status auf neues Enum mappen). Nach dem ersten Lauf sind keine alten
--    Werte mehr vorhanden → alle UPDATEs werden zu No-Ops (idempotent).
UPDATE tickets SET state = 'CLOSED', close_reason = 'resolved'       WHERE status = 'closed';
UPDATE tickets SET state = 'CLOSED', close_reason = 'false_positive' WHERE status = 'fp';
UPDATE tickets SET status = 'in_progress' WHERE status = 'progress';
UPDATE tickets SET status = 'assigned'    WHERE status IN ('open', 'closed', 'fp');

-- 4. Default auf neues Modell umstellen
ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'assigned';

-- 5. Constraints scharf schalten (DROP IF EXISTS vor ADD → idempotent)
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD  CONSTRAINT tickets_status_check
  CHECK (status IN ('assigned', 'in_progress', 'on_hold', 'awaiting_customer'));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_state_check;
ALTER TABLE tickets ADD  CONSTRAINT tickets_state_check
  CHECK (state IN ('OPEN', 'CLOSED'));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_close_reason_check;
ALTER TABLE tickets ADD  CONSTRAINT tickets_close_reason_check
  CHECK (close_reason IN ('', 'resolved', 'false_positive', 'duplicate', 'benign', 'other'));

-- 6. Index für den häufigsten Filter (state = OPEN)
CREATE INDEX IF NOT EXISTS idx_tickets_state ON tickets(state);

-- 7. Index für Integrations-Dedup (source + offense_id, z.B. Wazuh-Offense → Ticket)
CREATE INDEX IF NOT EXISTS idx_tickets_source_offense ON tickets(source, offense_id);

COMMENT ON COLUMN tickets.state        IS 'Lifecycle: OPEN | CLOSED';
COMMENT ON COLUMN tickets.close_reason IS 'Schliessgrund wenn state=CLOSED (z.B. false_positive)';
