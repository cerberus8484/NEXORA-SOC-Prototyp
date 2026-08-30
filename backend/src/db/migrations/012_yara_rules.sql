-- YARA-Regeln — gespeicherte Pattern-Matching-Regeln (JS-basiert, kein nativer YARA-Daemon).
-- Jede Regel hat: Name, Tags, String-Patterns (Array), Condition (all/any/threshold).

CREATE TABLE IF NOT EXISTS yara_rules (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  -- patterns: [{id, type(text|hex|regex), value, modifiers[]}]
  patterns    JSONB NOT NULL DEFAULT '[]',
  -- condition: 'all' | 'any' | { threshold: N }
  condition   JSONB NOT NULL DEFAULT '"any"',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  author      TEXT NOT NULL DEFAULT '',
  severity    TEXT NOT NULL DEFAULT 'medium',
  mitre_attack TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yara_rules_enabled_idx ON yara_rules(enabled);
CREATE INDEX IF NOT EXISTS yara_rules_tags_idx    ON yara_rules USING GIN(tags);
