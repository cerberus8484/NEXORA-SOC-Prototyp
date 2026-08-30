-- Migration 051: Deployment Center — Network as Code (vertikaler Schnitt #1 „OPNsense → Proxmox")
--
-- Erstmals ein Pfad, der ECHTE Infrastruktur schreibt (VM klonen/starten/zerstören) —
-- daher strikt gegated (DEPLOY_ENABLED, default AUS) und über das Apply-Kanal-Muster
-- (Draft → 4-Augen → Reauth → Plan → Apply, Rollback, Safe-Stop, Audit) geführt.
--
-- Diese Migration legt NUR das Datenmodell an. Repos/Orchestrator/Routen folgen in
-- späteren Phasen. Additiv + idempotent (IF NOT EXISTS). KEINE Secrets im Klartext:
-- Hypervisor-API-Token liegt ausschließlich verschlüsselt (secretsCrypto, enc:v1:) vor.

-- Hypervisor-Connector-Instanzen (WOHIN deployt wird). Token NUR verschlüsselt.
CREATE TABLE IF NOT EXISTS hypervisor_connectors (
  id               UUID        PRIMARY KEY,
  type             TEXT        NOT NULL,               -- Allowlist im Code (Schnitt #1: 'proxmox')
  name             TEXT        NOT NULL,
  host             TEXT        NOT NULL,
  api_token_enc    TEXT        NOT NULL,               -- enc:v1:… (AES-256-GCM) — NIE Klartext
  api_token_prefix TEXT        NOT NULL DEFAULT '',    -- nicht-geheimer Hinweis zur Identifikation
  target_node      TEXT        NOT NULL,
  storage          TEXT,
  bridge           TEXT,
  verify_tls       BOOLEAN     NOT NULL DEFAULT TRUE,
  status           TEXT        NOT NULL DEFAULT 'active',
  created_by       TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hypervisor_connectors_type ON hypervisor_connectors (type);

-- Immutabler Deploy-Wunsch (das „was würde deployt"). spec_hash = kanonisch + secret-gestrippt.
-- params trägt NIE ein Secret (adminPassword ist write-only, fließt separat zur Apply-Zeit).
CREATE TABLE IF NOT EXISTS deploy_specs (
  id           UUID        PRIMARY KEY,
  module_id    TEXT        NOT NULL,                   -- Allowlist im Code (Schnitt #1: 'opnsense')
  connector_id UUID        NOT NULL REFERENCES hypervisor_connectors (id) ON DELETE RESTRICT,
  target_node  TEXT        NOT NULL,
  storage      TEXT        NOT NULL,
  bridge       TEXT        NOT NULL,
  resources    JSONB       NOT NULL DEFAULT '{}',
  params       JSONB       NOT NULL DEFAULT '{}',      -- KEINE Secrets
  spec_hash    TEXT        NOT NULL,
  created_by   TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_specs_hash ON deploy_specs (spec_hash);
CREATE INDEX IF NOT EXISTS idx_deploy_specs_connector ON deploy_specs (connector_id);

-- Ein Deploy-Lifecycle je Spec (State-Machine). Single-flight + Replay-Schutz über Teil-Indizes:
-- höchstens EIN aktiver Run global, höchstens EIN deployed Run je Spec.
CREATE TABLE IF NOT EXISTS deploy_runs (
  id             UUID        PRIMARY KEY,
  spec_id        UUID        NOT NULL REFERENCES deploy_specs (id) ON DELETE CASCADE,
  status         TEXT        NOT NULL,                 -- planned|approved|applying|cloning|starting|configuring|verifying|deployed|rolling_back|rolled_back|failed_safe_stop
  vmid           INTEGER,                              -- gesetzt nach erfolgreichem clone
  started_by     TEXT        NOT NULL DEFAULT '',
  approved_by    TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at    TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_deploy_runs_spec ON deploy_runs (spec_id);
-- höchstens EIN gleichzeitig aktiver Run im ganzen System (Single-flight)
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_runs_single_active
  ON deploy_runs ((status IN ('applying','cloning','starting','configuring','verifying','rolling_back')))
  WHERE status IN ('applying','cloning','starting','configuring','verifying','rolling_back');
-- höchstens EIN erfolgreich deployter Run je Spec (Replay-Schutz)
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_runs_deployed_per_spec
  ON deploy_runs (spec_id) WHERE status = 'deployed';

-- Schritt-Audit je Run (append-only). detail ist redigiert — KEINE Token/Passwörter/Roh-config.xml.
CREATE TABLE IF NOT EXISTS deploy_run_steps (
  id      UUID        PRIMARY KEY,
  run_id  UUID        NOT NULL REFERENCES deploy_runs (id) ON DELETE CASCADE,
  step    TEXT        NOT NULL,                         -- clone|set_resources|attach_network|start|config_import|verify|rollback_destroy
  status  TEXT        NOT NULL,                         -- started|ok|failed
  detail  JSONB,                                        -- redigiert
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deploy_run_steps_run ON deploy_run_steps (run_id, at);

-- Append-only Audit der realen Ausführung (Plan/Approve/Apply/Rollback/Safe-Stop).
CREATE TABLE IF NOT EXISTS deploy_audit (
  id           UUID        PRIMARY KEY,
  type         TEXT        NOT NULL,
  actor        TEXT,
  spec_id      UUID,
  run_id       UUID,
  connector_id UUID,
  detail       JSONB,                                   -- redigiert; KEINE Secrets/Rohpayloads
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deploy_audit_at  ON deploy_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_audit_run ON deploy_audit (run_id);

-- Globale Deploy-Sperre. Wird bei failed_safe_stop gesetzt; blockiert ALLE weiteren
-- Applies bis manueller Review (zusätzlich zum Server-Flag DEPLOY_ENABLED).
CREATE TABLE IF NOT EXISTS deploy_safety_lock (
  id         TEXT        PRIMARY KEY DEFAULT 'global',
  locked     BOOLEAN     NOT NULL DEFAULT FALSE,
  reason     TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO deploy_safety_lock (id, locked, reason)
  VALUES ('global', FALSE, '') ON CONFLICT (id) DO NOTHING;

-- Append-only auf DB-Ebene: UPDATE/DELETE an Schritt-Audit + Deploy-Audit blockieren.
CREATE OR REPLACE FUNCTION deploy_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% ist append-only (% nicht erlaubt)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deploy_run_steps_append_only ON deploy_run_steps;
CREATE TRIGGER trg_deploy_run_steps_append_only
  BEFORE UPDATE OR DELETE ON deploy_run_steps
  FOR EACH ROW EXECUTE FUNCTION deploy_block_mutation();

DROP TRIGGER IF EXISTS trg_deploy_audit_append_only ON deploy_audit;
CREATE TRIGGER trg_deploy_audit_append_only
  BEFORE UPDATE OR DELETE ON deploy_audit
  FOR EACH ROW EXECUTE FUNCTION deploy_block_mutation();
