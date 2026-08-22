'use strict';

// ── TDD RED: OIDC-Client-Kern (Slice 1, reine Logik, kein Netz) ─────────────
// Deckt die "Request-Seite" + Claim-Prüfung des Authorization-Code-+-PKCE-Flows ab:
//   generatePkcePair / generateState / generateNonce — Crypto (RFC 7636 S256)
//   buildAuthorizationUrl                            — reine URL-Konstruktion
//   parseDiscovery                                   — Discovery-Doc validieren
//   validateIdTokenClaims                            — Claim-Prüfung (NACH Signatur)
//
// Sicherheits-Invarianten (hart):
//   - PKCE-Challenge == base64url(SHA-256(verifier)), Methode S256
//   - Discovery erzwingt https-Endpoints (kein Downgrade)
//   - Claim-Prüfung lehnt iss-/aud-/nonce-Mismatch + Ablauf ab

const crypto = require('crypto');
const {
  generatePkcePair,
  generateState,
  generateNonce,
  buildAuthorizationUrl,
  parseDiscovery,
  validateIdTokenClaims,
} = require('../../src/auth/oidc/oidcClient');

// ── PKCE ─────────────────────────────────────────────────────────────────────

describe('generatePkcePair()', () => {
  test('verifier ist base64url, 43–128 Zeichen (RFC 7636)', () => {
    const { verifier } = generatePkcePair();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url, keine Polsterung
  });

  test('challenge == base64url(SHA-256(verifier)), Methode S256', () => {
    const { verifier, challenge } = generatePkcePair();
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(challenge).not.toContain('='); // keine Polsterung
  });

  test('zwei Aufrufe liefern unterschiedliche Verifier (Zufall)', () => {
    expect(generatePkcePair().verifier).not.toBe(generatePkcePair().verifier);
  });
});

describe('generateState() / generateNonce()', () => {
  test('liefern nicht-leere base64url-Strings', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(generateNonce()).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  test('sind zwischen Aufrufen verschieden (CSRF/Replay-Schutz)', () => {
    expect(generateState()).not.toBe(generateState());
    expect(generateNonce()).not.toBe(generateNonce());
  });
});

// ── Authorization-URL ─────────────────────────────────────────────────────────

describe('buildAuthorizationUrl()', () => {
  const params = {
    authorizationEndpoint: 'https://idp.example.com/authorize',
    clientId:    'soc-client',
    redirectUri: 'https://soc.example.com/api/v1/auth/oidc/callback',
    scope:       'openid profile email',
    state:       'state-123',
    nonce:       'nonce-456',
    codeChallenge: 'chal-789',
  };

  test('beginnt mit dem Authorization-Endpoint', () => {
    expect(buildAuthorizationUrl(params)).toMatch(/^https:\/\/idp\.example\.com\/authorize\?/);
  });

  test('enthält alle Pflicht-Query-Parameter (Authorization Code + PKCE S256)', () => {
    const u = new URL(buildAuthorizationUrl(params));
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('soc-client');
    expect(u.searchParams.get('redirect_uri')).toBe(params.redirectUri);
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('state')).toBe('state-123');
    expect(u.searchParams.get('nonce')).toBe('nonce-456');
    expect(u.searchParams.get('code_challenge')).toBe('chal-789');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('kodiert redirect_uri und scope korrekt (kein roher Doppelpunkt/Leerzeichen)', () => {
    const raw = buildAuthorizationUrl(params);
    expect(raw).toContain('redirect_uri=https%3A%2F%2Fsoc.example.com');
    expect(raw).toContain('scope=openid%20profile%20email');
  });
});

// ── Discovery ─────────────────────────────────────────────────────────────────

describe('parseDiscovery()', () => {
  const doc = {
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
  };

  test('extrahiert die vier Pflicht-Endpoints aus gültigem Doc', () => {
    expect(parseDiscovery(doc)).toEqual({
      issuer: 'https://idp.example.com',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      jwksUri: 'https://idp.example.com/jwks',
    });
  });

  test('wirft bei fehlendem authorization_endpoint', () => {
    const broken = { ...doc };
    delete broken.authorization_endpoint;
    expect(() => parseDiscovery(broken)).toThrow();
  });

  test('wirft bei fehlendem issuer', () => {
    const broken = { ...doc };
    delete broken.issuer;
    expect(() => parseDiscovery(broken)).toThrow();
  });

  test('lehnt http-Endpoint ab (kein TLS-Downgrade)', () => {
    const insecure = { ...doc, token_endpoint: 'http://idp.example.com/token' };
    expect(() => parseDiscovery(insecure)).toThrow();
  });
});

// ── ID-Token-Claim-Prüfung (NACH Signatur — siehe JSDoc) ─────────────────────

describe('validateIdTokenClaims()', () => {
  const now = 1_700_000_000;
  const base = {
    iss:   'https://idp.example.com',
    aud:   'soc-client',
    sub:   'user-abc',
    exp:   now + 300,
    iat:   now - 5,
    nonce: 'nonce-456',
  };
  const exp = { issuer: 'https://idp.example.com', clientId: 'soc-client', nonce: 'nonce-456', now };

  test('gültige Claims → { ok: true }', () => {
    expect(validateIdTokenClaims(base, exp)).toEqual({ ok: true });
  });

  test('falscher issuer → ok:false reason issuer_mismatch', () => {
    const r = validateIdTokenClaims({ ...base, iss: 'https://evil.example.com' }, exp);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('issuer_mismatch');
  });

  test('falsche audience → ok:false reason audience_mismatch', () => {
    const r = validateIdTokenClaims({ ...base, aud: 'other-client' }, exp);
    expect(r).toEqual({ ok: false, reason: 'audience_mismatch' });
  });

  test('aud als Array mit clientId → ok', () => {
    expect(validateIdTokenClaims({ ...base, aud: ['x', 'soc-client'] }, exp)).toEqual({ ok: true });
  });

  test('abgelaufen (exp < now - Toleranz) → ok:false reason expired', () => {
    const r = validateIdTokenClaims({ ...base, exp: now - 120 }, exp);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  test('nonce-Mismatch → ok:false reason nonce_mismatch (Replay-Schutz)', () => {
    const r = validateIdTokenClaims({ ...base, nonce: 'fremd' }, exp);
    expect(r).toEqual({ ok: false, reason: 'nonce_mismatch' });
  });

  test('fehlendes sub → ok:false reason missing_subject', () => {
    const broken = { ...base };
    delete broken.sub;
    expect(validateIdTokenClaims(broken, exp).reason).toBe('missing_subject');
  });

  test('iat zu weit in der Zukunft → ok:false reason issued_in_future', () => {
    const r = validateIdTokenClaims({ ...base, iat: now + 600 }, exp);
    expect(r).toEqual({ ok: false, reason: 'issued_in_future' });
  });
});
