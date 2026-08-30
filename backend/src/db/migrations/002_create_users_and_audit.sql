-- P6 Migration: Users + Audit Log

-- ── USERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'analyst'
                CHECK (role IN ('admin','analyst','viewer')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── AUDIT LOG ─────────────────────────────────────────────
-- append-only — kein DELETE, kein UPDATE erlaubt (via App-Policy)
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT        NOT NULL DEFAULT '',  -- Name/Email zur Anzeige (denormalisiert)
  action        TEXT        NOT NULL,             -- z.B. LOGIN, TICKET_CREATE, TICKET_DELETE
  target_type   TEXT        NOT NULL DEFAULT '',  -- z.B. 'ticket', 'user'
  target_id     TEXT        NOT NULL DEFAULT '',  -- ID des betroffenen Objekts
  metadata      JSONB       NOT NULL DEFAULT '{}',-- Änderungsdetails, Request-Infos
  ip_address    TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target    ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);

-- JWT Blocklist (für Logout — ungültige Tokens)
CREATE TABLE IF NOT EXISTS jwt_blocklist (
  jti        TEXT        PRIMARY KEY,  -- JWT ID
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jwt_expires ON jwt_blocklist(expires_at);

COMMENT ON TABLE audit_log  IS 'Audit Log — append-only, kein UPDATE/DELETE';
COMMENT ON TABLE users       IS 'Benutzeraccounts — Passwörter nur als bcrypt Hash';
COMMENT ON TABLE jwt_blocklist IS 'Invalidierte JWT Tokens (Logout)';
