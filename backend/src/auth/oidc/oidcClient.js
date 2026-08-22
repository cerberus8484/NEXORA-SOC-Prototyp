'use strict';

/**
 * oidcClient.js — Kern des OIDC-Logins (Authorization Code + PKCE), Slice 1.
 *
 * Reine, netz-freie Logik der "Request-Seite" + Claim-Prüfung:
 *   - PKCE (RFC 7636, Methode S256) · state · nonce  — Node-Crypto, keine externe Lib
 *   - Authorization-URL-Konstruktion
 *   - Discovery-Dokument validieren (erzwingt https — kein TLS-Downgrade)
 *   - ID-Token-CLAIM-Prüfung (iss/aud/exp/iat/nonce/sub)
 *
 * WICHTIG (Slice-Grenze): `validateIdTokenClaims` prüft NUR die Claims. Die
 * kryptografische SIGNATUR-Prüfung gegen die JWKS des IdP folgt in Slice 2
 * (jose). Diese Funktion DARF NIE allein als Token-Verifikation gelten —
 * Signatur zuerst, dann Claims.
 *
 * Token-Tausch + Discovery-/JWKS-Fetch + Routen + Account-Linking: Slice 2.
 */

const crypto = require('crypto');

// PKCE-Verifier: 32 Zufalls-Bytes → base64url = 43 Zeichen (RFC-7636-konform, 43–128).
const PKCE_VERIFIER_BYTES = 32;
// Toleranz für Uhren-Drift zwischen IdP und uns (Sekunden).
const DEFAULT_CLOCK_TOLERANCE_SEC = 60;

/**
 * Erzeugt ein PKCE-Paar: Klartext-Verifier + S256-Challenge.
 * challenge = base64url(SHA-256(verifier)).
 *
 * @returns {{ verifier: string, challenge: string }}
 */
function generatePkcePair() {
  const verifier = crypto.randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Zufälliger CSRF-`state` (base64url). */
function generateState() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Zufälliger `nonce` (base64url) — bindet das ID-Token an genau diese Login-Anfrage. */
function generateNonce() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Baut die Authorization-Request-URL (Authorization Code Flow + PKCE S256).
 *
 * @param {{ authorizationEndpoint: string, clientId: string, redirectUri: string,
 *           scope: string, state: string, nonce: string, codeChallenge: string }} params
 * @returns {string}
 */
function buildAuthorizationUrl({
  authorizationEndpoint, clientId, redirectUri, scope, state, nonce, codeChallenge,
}) {
  const url = new URL(authorizationEndpoint);
  const q = new URLSearchParams({
    response_type:         'code',
    client_id:             clientId,
    redirect_uri:          redirectUri,
    scope,
    state,
    nonce,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });
  // URLSearchParams kodiert Leerzeichen als '+'; manche IdPs (z.B. Entra) sind im
  // scope strikt → auf das interoperablere '%20' normalisieren. Sicher, weil ein
  // echtes '+' im Wert bereits als '%2B' kodiert ist (übrige '+' = nur Leerzeichen).
  url.search = q.toString().replace(/\+/g, '%20');
  return url.toString();
}

/**
 * Validiert ein OIDC-Discovery-Dokument und extrahiert die genutzten Endpoints.
 * Erzwingt absolute https-URLs (kein TLS-Downgrade auf http).
 *
 * @param {object} doc — geparstes .well-known/openid-configuration
 * @returns {{ issuer: string, authorizationEndpoint: string, tokenEndpoint: string, jwksUri: string }}
 * @throws {Error} bei fehlendem oder nicht-https Endpoint
 */
function parseDiscovery(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('OIDC-Discovery: leeres oder ungültiges Dokument');
  }
  const requireHttps = (value, name) => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`OIDC-Discovery: '${name}' fehlt`);
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`OIDC-Discovery: '${name}' ist keine gültige URL`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`OIDC-Discovery: '${name}' muss https sein (kein TLS-Downgrade)`);
    }
    return value;
  };

  return {
    issuer:                requireHttps(doc.issuer,                 'issuer'),
    authorizationEndpoint: requireHttps(doc.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint:         requireHttps(doc.token_endpoint,         'token_endpoint'),
    jwksUri:               requireHttps(doc.jwks_uri,               'jwks_uri'),
  };
}

/**
 * Prüft die Claims eines ID-Tokens gegen die Erwartungen dieser Login-Anfrage.
 * NUR Claim-Ebene — die Signaturprüfung (JWKS) MUSS vorher erfolgt sein (Slice 2).
 *
 * Gibt { ok: true } oder { ok: false, reason } zurück (nie ein Wurf) — der Aufrufer
 * loggt `reason` serverseitig und liefert nach außen einen einheitlichen Fehler.
 *
 * @param {object} claims — dekodierte ID-Token-Claims
 * @param {{ issuer: string, clientId: string, nonce?: string, now?: number, clockToleranceSec?: number }} expected
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateIdTokenClaims(claims, expected) {
  const {
    issuer,
    clientId,
    nonce,
    now = Math.floor(Date.now() / 1000),
    clockToleranceSec = DEFAULT_CLOCK_TOLERANCE_SEC,
  } = expected || {};

  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'no_claims' };

  if (claims.iss !== issuer) return { ok: false, reason: 'issuer_mismatch' };

  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(clientId)
    : claims.aud === clientId;
  if (!audOk) return { ok: false, reason: 'audience_mismatch' };

  if (typeof claims.exp !== 'number' || claims.exp < now - clockToleranceSec) {
    return { ok: false, reason: 'expired' };
  }

  if (typeof claims.iat === 'number' && claims.iat > now + clockToleranceSec) {
    return { ok: false, reason: 'issued_in_future' };
  }

  // nonce nur prüfen, wenn eine Erwartung übergeben wurde (immer der Fall im Flow).
  if (nonce !== undefined && claims.nonce !== nonce) {
    return { ok: false, reason: 'nonce_mismatch' };
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { ok: false, reason: 'missing_subject' };
  }

  return { ok: true };
}

module.exports = {
  generatePkcePair,
  generateState,
  generateNonce,
  buildAuthorizationUrl,
  parseDiscovery,
  validateIdTokenClaims,
};
