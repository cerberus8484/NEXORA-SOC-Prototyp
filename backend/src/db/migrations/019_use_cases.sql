-- Use-Case-Bibliothek — geteilte Liste von Use-Case-Labels (aus dem Ursprungs-Tool
-- portiert, war pro-Browser localStorage `soc_usecases`). Der Analyst wählt beim
-- Anlegen eines Tickets einen Use-Case aus dieser Bibliothek.

CREATE TABLE IF NOT EXISTS use_cases (
  id         UUID PRIMARY KEY,
  value      TEXT NOT NULL UNIQUE,
  author     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
