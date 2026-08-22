-- Threat-Intel-Einträge am Ticket — mehrere TI-Einträge pro Ticket (Editor-Parität).
-- Eingebettetes JSONB-Array [{ id, category, actor, malware, confidence }];
-- behebt zugleich die Persistenz-Lücke (Actor/Malware/Confidence wurden vorher
-- gar nicht gespeichert). Additiv, Default '[]' — kein Backfill nötig.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ti_entries JSONB NOT NULL DEFAULT '[]';
