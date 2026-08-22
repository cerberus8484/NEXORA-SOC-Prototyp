'use strict';

/**
 * oidcInstance.js — Boot-Wiring des OIDC-Logins.
 *
 * Hier (und NUR hier) leben die echten Seiteneffekte: HTTP (node-fetch) für
 * Discovery + Token-Tausch und die JWKS-Signaturprüfung via `jose`. Der
 * OidcService selbst bleibt dadurch netzfrei und voll unit-testbar.
 *
 * KONFIG (P1 #6, In-UI-Admin):
 *   - Die effektive Config kommt DYNAMISCH aus dem Settings-Store (DB) mit
 *     ENV-Fallback (oidcConfigService.getEffectiveOidcConfig). Sie wird pro
 *     Login frisch aufgelöst — ein Admin-Wechsel (Issuer/Client/Secret/enabled)
 *     wirkt ohne Neustart.
 *   - Das Client-Secret wird erst beim Token-Tausch (hier) verwendet und
 *     verlässt den Server nie.
 *
 * SICHERHEIT:
 *   - redirect:'error' auf allen Fetches (kein automatisches Folgen von 3xx → SSRF-Härtung).
 *   - Geteilte User-Repo-Instanz mit dem AuthService: in beiden Persistenz-Modi
 *     (InMemory/Postgres) müssen Linking/Signup und _issueSession auf DENSELBEN
 *     Store wirken (dokumentierte Repo-Instanz-Falle).
 */

const fetch = require('node-fetch');
const { parseDiscovery } = require('./oidcClient');
const { OidcService } = require('./oidcService');
const { getEffectiveOidcConfig } = require('./oidcConfigService');
const { createSettingsRepository } = require('../../repositories/settingsRepositoryFactory');
const { authService } = require('../../services/AuthService');

// Geteilter Settings-Store (Singleton) — dieselbe Instanz wie die settings-Route.
const settingsRepo = createSettingsRepository();

// Discovery pro Issuer cachen — ein Admin-Issuer-Wechsel legt einen neuen Eintrag
// an, ohne den alten zu treffen. TTL, damit ein rotierendes Discovery-Doc
// (z.B. geänderter jwks_uri) nach spätestens 1h frisch nachgeladen wird.
const _discoByIssuer = new Map(); // norm → { value, expiresAt }
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function discover(issuer) {
  const norm = (issuer || '').replace(/\/+$/, '');
  if (!norm) throw new Error('OIDC issuer nicht konfiguriert');
  const cached = _discoByIssuer.get(norm);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(`${norm}/.well-known/openid-configuration`, { redirect: 'error' });
  if (!res.ok) throw new Error(`OIDC discovery HTTP ${res.status}`);
  const parsed = parseDiscovery(await res.json());
  _discoByIssuer.set(norm, { value: parsed, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return parsed;
}

async function exchangeCode({ tokenEndpoint, code, codeVerifier, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    client_id:     clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(tokenEndpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`OIDC token exchange HTTP ${res.status}`);
  return res.json();
}

// `jose` ist ESM-first; ein Top-Level-require bricht unter Jest (und ist nur im
// echten SSO-Flow nötig). Daher LAZY laden — Tests/Imports berühren jose nie.
let _jose = null;
function jose() {
  if (!_jose) _jose = require('jose');
  return _jose;
}

// JWKS pro jwksUri cachen — createRemoteJWKSet holt + rotiert Keys intern.
const _jwksByUri = new Map();
function jwksFor(jwksUri) {
  let jwks = _jwksByUri.get(jwksUri);
  if (!jwks) {
    jwks = jose().createRemoteJWKSet(new URL(jwksUri));
    _jwksByUri.set(jwksUri, jwks);
  }
  return jwks;
}

async function verifyIdToken(idToken, { issuer, audience, jwksUri }) {
  // jose prüft Signatur + iss/aud/exp; den nonce-Abgleich macht der OidcService danach.
  const { payload } = await jose().jwtVerify(idToken, jwksFor(jwksUri), { issuer, audience });
  return payload;
}

const oidcService = new OidcService({
  // Dynamische, DB-basierte Config (In-UI-Admin) mit ENV-Fallback — pro Login frisch.
  getConfig: () => getEffectiveOidcConfig(settingsRepo),
  discover,
  exchangeCode,
  verifyIdToken,
  // Geteilte Instanz (siehe Kopf-Kommentar) — nicht createUserRepository() neu aufrufen.
  userRepository: authService._users,
  authService,
});

module.exports = { oidcService, discover, exchangeCode, verifyIdToken, settingsRepo };
