-- Migration 027: autonomy_policies
-- AutonomyPolicy-Gate — inert, default-deny, AUTONOMY_ENABLED=false.
-- ADR-016: Autonomie-Fundament, keine Live-Aktivierung durch diese Migration.
--
-- DSGVO Art. 22-Hinweis:
--   host_response und external_comms bleiben per Decke human-only.
--   Keine ausschließlich automatisierte Entscheidung mit erheblicher Wirkung.
--
-- Idempotenz: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS autonomy_policies (
  id                    UUID        PRIMARY KEY,
  customer              TEXT        NOT NULL DEFAULT '*',
  action_class          TEXT        NOT NULL,
  mode                  TEXT        NOT NULL DEFAULT 'advisory',
  min_verdict           TEXT        NOT NULL DEFAULT 'confirmed_incident',
  min_confidence        REAL        NOT NULL DEFAULT 0.9,
  require_evidence_floor BOOLEAN    NOT NULL DEFAULT true,
  max_per_hour          INTEGER     NOT NULL DEFAULT 0,
  enabled               BOOLEAN     NOT NULL DEFAULT false,
  created_by            TEXT        NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique-Constraint: Ein Mandant darf je Aktionsklasse nur eine Policy haben.
-- Entspricht dem Scope (customer × actionClass) aus ADR-016.
CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomy_policies_scope
  ON autonomy_policies (customer, action_class);
