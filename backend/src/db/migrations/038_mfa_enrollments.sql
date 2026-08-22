-- Migration 038: MFA-Enrollments (TOTP / RFC 6238) — Security-Welle 3
-- Eine Anmeldung pro User. secret_enc = AES-256-GCM-verschlüsseltes TOTP-Secret
-- (NIE Klartext). recovery_codes = JSONB-Array aus { hash (SHA-256), usedAt }.

CREATE TABLE IF NOT EXISTS mfa_enrollments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending',  -- pending | active | disabled
  secret_enc     TEXT        NOT NULL,                    -- verschlüsseltes Secret, nie Klartext
  recovery_codes JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{ hash, usedAt }] — nur Hashes
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at   TIMESTAMPTZ,
  disabled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mfa_enrollments_user_id ON mfa_enrollments(user_id);
