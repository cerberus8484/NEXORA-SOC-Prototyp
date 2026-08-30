-- KI Use-Case Developer: Drafts mit Status-Lifecycle + JSONB-Payload.
-- Kernfelder als Spalten (Filterung/Index), Rest als JSONB (payload).
--
-- DSGVO: payload kann PII enthalten (IPs/Hostnames in detectionLogic/testCases.event).
-- Datensparsamkeit-Pflicht (Art. 5 Abs. 1 lit. c) liegt beim Befüller (Agent UCD-C).
-- Keine separaten Indexe auf PII-haltigen JSONB-Subfeldern.
--
-- Status-Lifecycle: draft → in_review → approved | rejected; approved → published.

CREATE TABLE IF NOT EXISTS use_case_drafts (
  id            UUID         PRIMARY KEY,
  title         TEXT         NOT NULL DEFAULT '',
  source_type   TEXT         NOT NULL DEFAULT 'manual',
  source_id     TEXT         NOT NULL DEFAULT '',
  status        TEXT         NOT NULL DEFAULT 'draft',
  severity      TEXT         NOT NULL DEFAULT 'medium',
  confidence    NUMERIC(5,2) NOT NULL DEFAULT 0     CHECK (confidence >= 0 AND confidence <= 100),
  generated_by  TEXT         NOT NULL DEFAULT 'ollama',
  reviewed_by   TEXT         NULL,
  -- Alle erweiterten Felder (description, detectionGoal, dataSources, requiredFields,
  -- detectionLogic, mitre, falsePositiveRisks, testCases, recommendedActions, playbookSteps)
  -- als JSONB — flexibel für KI-generierte Varianten und ohne Schema-Migration beim Wachsen.
  payload       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT ucd_status_check
    CHECK (status IN ('draft','in_review','approved','rejected','published')),
  CONSTRAINT ucd_source_type_check
    CHECK (source_type IN ('ticket','finding','evidence','wazuh_rule','manual')),
  CONSTRAINT ucd_severity_check
    CHECK (severity IN ('low','medium','high','critical'))
);

-- Filterung nach Workflow-Status (Dashboard-Abfragen, Review-Queue)
CREATE INDEX IF NOT EXISTS idx_ucd_status     ON use_case_drafts (status);
-- Filterung nach Ursprungsquelle (Ticket/Finding → welche Drafts existieren?)
CREATE INDEX IF NOT EXISTS idx_ucd_source     ON use_case_drafts (source_type, source_id);
-- Zeitliche Sortierung
CREATE INDEX IF NOT EXISTS idx_ucd_created    ON use_case_drafts (created_at DESC);

COMMENT ON TABLE  use_case_drafts IS 'KI-generierte Use-Case-Drafts mit Review-Lifecycle (draft→in_review→approved|rejected→published)';
COMMENT ON COLUMN use_case_drafts.payload     IS 'JSONB: description, detectionGoal, dataSources, requiredFields, detectionLogic, mitre, falsePositiveRisks, testCases, recommendedActions, playbookSteps. Kann PII enthalten — Befüller-Pflicht: Art. 5 Abs. 1 lit. c DSGVO.';
COMMENT ON COLUMN use_case_drafts.confidence  IS '0–100: KI-Konfidenz des generierten Use-Case';
COMMENT ON COLUMN use_case_drafts.source_id   IS 'ID des Quellobjekts (Ticket-UUID, Finding-ID, …)';

-- updated_at automatisch pflegen (Projektkonvention wie tickets/users etc.) — damit
-- updated_at auch bei direkten DB-Patches korrekt bleibt, nicht nur über das Repo.
DROP TRIGGER IF EXISTS ucd_set_updated_at ON use_case_drafts;
CREATE TRIGGER ucd_set_updated_at
  BEFORE UPDATE ON use_case_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
