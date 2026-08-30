-- Migration 040: WebAuthn/Passkey-Credentials (FIDO2) — Security-Welle 3
-- Ein User kann mehrere Authenticatoren registrieren. credential_id + public_key
-- sind per WebAuthn-Design oeffentlich (keine Secrets). counter = Signatur-Zaehler
-- fuer Clone-Erkennung. Additive Migration (kein Bestand betroffen).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT        NOT NULL UNIQUE,   -- base64url, externer Authenticator-Identifier
  public_key    TEXT        NOT NULL,          -- base64url COSE public key
  counter       BIGINT      NOT NULL DEFAULT 0,
  transports    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  device_type   TEXT,
  backed_up     BOOLEAN     NOT NULL DEFAULT false,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
