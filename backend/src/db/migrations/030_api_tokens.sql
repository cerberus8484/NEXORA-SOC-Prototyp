-- Migration 030: Personal Access Tokens (PAT)
-- Wave C — API_TOKENS_ENABLED=false (default inert)

CREATE TABLE IF NOT EXISTS api_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE,
  prefix        TEXT        NOT NULL,  -- "soc_xxxxxxxx..." für Anzeige (niemals Vollwert)
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked       BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash    ON api_tokens(token_hash) WHERE NOT revoked;
