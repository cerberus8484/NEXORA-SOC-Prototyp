-- Analyse-Vorlagen — geteilte Vorlagen-Bibliothek (aus dem Ursprungs-Tool portiert,
-- war pro-Browser localStorage `soc_analyse_vtpl`). Eine Vorlage füllt beim Anlegen
-- eines Tickets die Textfelder vor: Beschreibung, IOCs, Logs, Maßnahmen, Empfehlung, Notizen.
-- `descr` statt `desc` (reserviertes SQL-Schlüsselwort).

CREATE TABLE IF NOT EXISTS analysis_templates (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  descr      TEXT NOT NULL DEFAULT '',
  iocs       TEXT NOT NULL DEFAULT '',
  logs       TEXT NOT NULL DEFAULT '',
  actions    TEXT NOT NULL DEFAULT '',
  rec        TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analysis_templates_created_idx ON analysis_templates(created_at DESC);
