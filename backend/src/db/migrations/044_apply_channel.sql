-- Migration 044: Kontrollierter Apply-Kanal (P_CORR_ADMIN_2 Stufe 2)
--
-- Erstmals ein ECHTER, eng begrenzter Apply: ein genehmigter Draft wird zu einem
-- immutablen Apply-Plan eingefroren und über einen Apply-Run kontrolliert in einen
-- VERSIONIERTEN Runtime-Config-Store (DB) geschrieben — KEIN OS-File, kein Env,
-- kein Prozess-Restart, kein Shell/SSH. Nur die zwei eligible Worker-Parameter.
--
-- Trennung: Draft-/Approval-Historie (config_*) bleibt unberührt; hier liegt die
-- reale Ausführungs-Historie. Additiv + idempotent (IF NOT EXISTS). KEINE Secrets.

-- Immutabler Snapshot eines genehmigten Drafts (das „was würde angewendet").
CREATE TABLE IF NOT EXISTS apply_plans (
  id               UUID        PRIMARY KEY,
  draft_id         UUID        NOT NULL,
  capability_id    TEXT        NOT NULL,
  target_id        TEXT        NOT NULL,
  value            JSONB       NOT NULL DEFAULT '{}',
  plan_hash        TEXT        NOT NULL,   -- sha256 über kanonische {cap,target,value,expectedVersion}
  expected_version INTEGER     NOT NULL,   -- Draft-Version zum Zeitpunkt des Einfrierens (Anti-TOCTOU)
  created_by       TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apply_plans_draft ON apply_plans (draft_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_apply_plans_hash ON apply_plans (plan_hash);

-- Ein Ausführungsversuch eines Plans (State-Machine). Replay-/Single-flight-Backstop
-- über Teil-Indizes: höchstens EIN aktiver Run global, höchstens EIN applied Run je Plan.
CREATE TABLE IF NOT EXISTS apply_runs (
  id             UUID        PRIMARY KEY,
  plan_id        UUID        NOT NULL REFERENCES apply_plans (id) ON DELETE CASCADE,
  status         TEXT        NOT NULL,    -- applying|reloading|applied|rolling_back|rolled_back|failed_safe_stop
  started_by     TEXT        NOT NULL DEFAULT '',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  config_version INTEGER,                 -- geschriebene runtime_config.version
  health         JSONB,                   -- Health-Ergebnis (redigiert)
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_apply_runs_plan ON apply_runs (plan_id);
-- höchstens EIN gleichzeitig aktiver Run im ganzen System (Single-flight)
CREATE UNIQUE INDEX IF NOT EXISTS uq_apply_runs_single_active
  ON apply_runs ((status IN ('applying','reloading','rolling_back')))
  WHERE status IN ('applying','reloading','rolling_back');
-- höchstens EIN erfolgreich angewendeter Run je Plan (Replay-Schutz)
CREATE UNIQUE INDEX IF NOT EXISTS uq_apply_runs_applied_per_plan
  ON apply_runs (plan_id) WHERE status = 'applied';

-- Versionierter Runtime-Config-Store. Der Worker liest den AKTIVEN Wert je
-- (capability,target) an Job-Grenzen. Jeder Apply/Rollback schreibt eine neue
-- Version; höchstens EINE aktive Zeile je (capability,target).
CREATE TABLE IF NOT EXISTS runtime_config (
  id            UUID        PRIMARY KEY,
  capability_id TEXT        NOT NULL,
  target_id     TEXT        NOT NULL,
  value         JSONB       NOT NULL DEFAULT '{}',
  version       INTEGER     NOT NULL,
  applied_by    TEXT        NOT NULL DEFAULT '',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runtime_config_key ON runtime_config (capability_id, target_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_runtime_config_active
  ON runtime_config (capability_id, target_id) WHERE active;

-- Append-only Audit der realen Ausführung (Plan/Apply/Health/Rollback/Safe-Stop).
CREATE TABLE IF NOT EXISTS apply_audit (
  id            UUID        PRIMARY KEY,
  type          TEXT        NOT NULL,
  actor         TEXT,
  plan_id       UUID,
  run_id        UUID,
  capability_id TEXT,
  detail        JSONB,                    -- redigiert; KEINE Secrets/Rohpayloads
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apply_audit_at  ON apply_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_apply_audit_run ON apply_audit (run_id);

-- Globale Apply-Sperre. Wird bei failed_safe_stop gesetzt; blockiert ALLE weiteren
-- Applies bis manueller Review (zusätzlich zum Server-Flag CONFIG_APPLY_ENABLED).
CREATE TABLE IF NOT EXISTS apply_safety_lock (
  id         TEXT        PRIMARY KEY DEFAULT 'global',
  locked     BOOLEAN     NOT NULL DEFAULT FALSE,
  reason     TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO apply_safety_lock (id, locked, reason)
  VALUES ('global', FALSE, '') ON CONFLICT (id) DO NOTHING;
