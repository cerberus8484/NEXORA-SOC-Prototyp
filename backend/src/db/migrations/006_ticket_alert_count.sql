-- Recurrence-Counter: wie oft hat die Offense gefeuert?
--
-- Ein dedupliziertes Ticket repräsentiert tausende Alerts derselben Rule+Agent.
-- alert_count macht dieses Gewicht sichtbar (UI: "⟳ N Vorkommen").
-- "Zuletzt gesehen" = updated_at (wird bei jedem Update ohnehin gesetzt).
--
-- Idempotent.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS alert_count INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN tickets.alert_count IS 'Anzahl Alerts, die zu dieser Offense korreliert wurden (Dedup-Counter)';
