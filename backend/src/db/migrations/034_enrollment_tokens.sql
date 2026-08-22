-- Migration 034: enrollment_tokens (P_AGENT_1)
-- Bootstrap-Credentials für Node-Enrollment. **Es wird NUR der SHA-256-Hash
-- gespeichert** — niemals der Klartext-Token (der wird genau einmal beim Mint
-- zurückgegeben). Kein Apply-/Remote-/Netz-Bezug; reines Credential-Modell.
-- Idempotenz: IF NOT EXISTS auf allen Objekten.

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id                     UUID        PRIMARY KEY,
  enrollment_profile_id  UUID        NOT NULL,
  token_hash             TEXT        NOT NULL UNIQUE,  -- SHA-256, nie Klartext
  prefix                 TEXT        NOT NULL DEFAULT '',
  expires_at             TIMESTAMPTZ,
  revoked                BOOLEAN     NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash    ON enrollment_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_profile ON enrollment_tokens (enrollment_profile_id);
