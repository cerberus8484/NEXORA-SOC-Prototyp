-- Migration 039: SSO / OIDC Account-Linking (Security-Welle 3)
-- Bindet einen bestehenden User an seine externe IdP-Identität.
--   oidc_provider = IdP-issuer (z.B. https://idp.example.com/realms/soc)
--   oidc_sub      = stabiler IdP-Subject-Identifier
-- Beide NULL = reiner Passwort-Login (Bestand unverändert, additive Migration).
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_provider TEXT;

-- Eine externe Identität darf höchstens einem User gehören (kein Identitäts-Sharing).
-- Partieller Unique-Index: greift nur bei gesetzter Bindung, lässt beliebig viele
-- ungelinkte (NULL) User zu.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_identity
  ON users (oidc_provider, oidc_sub)
  WHERE oidc_sub IS NOT NULL;
