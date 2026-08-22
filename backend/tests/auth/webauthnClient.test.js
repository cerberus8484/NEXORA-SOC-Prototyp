'use strict';

// ── TDD RED: WebAuthn-Client-Kern (Slice 1, reine Logik, kein Netz/keine Krypto) ─
// Deckt die "Request-Seite" + clientData-Prüfung der FIDO2-Ceremonies ab:
//   generateChallenge                 — Zufalls-Challenge (base64url)
//   buildRegistrationOptions          — PublicKeyCredentialCreationOptions (rein)
//   buildAuthenticationOptions        — PublicKeyCredentialRequestOptions (rein)
//   validateClientDataExpectations    — type/challenge/origin-Prüfung (NACH Signatur)
//
// Sicherheits-Invarianten (hart):
//   - Challenge ist base64url, ausreichend lang, pro Aufruf verschieden (Replay-Schutz)
//   - pubKeyCredParams bieten ES256 (-7) + RS256 (-257)
//   - clientData-Prüfung lehnt type-/challenge-/origin-Mismatch ab

const {
  generateChallenge,
  buildRegistrationOptions,
  buildAuthenticationOptions,
  validateClientDataExpectations,
} = require('../../src/auth/webauthn/webauthnClient');

// ── Challenge ─────────────────────────────────────────────────────────────────

describe('generateChallenge()', () => {
  test('liefert einen base64url-String (>= 43 Zeichen = 32 Byte)', () => {
    const c = generateChallenge();
    expect(typeof c).toBe('string');
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(c.length).toBeGreaterThanOrEqual(43);
  });

  test('ist zwischen Aufrufen verschieden (Replay-Schutz)', () => {
    expect(generateChallenge()).not.toBe(generateChallenge());
  });
});

// ── Registration-Options ──────────────────────────────────────────────────────

describe('buildRegistrationOptions()', () => {
  const params = {
    rpId:   'nexora.example',
    rpName: 'Nexora SOC',
    user:   { id: 'user-123', name: 'a@nexora.example', displayName: 'Alice' },
    challenge: 'chal-abc',
    excludeCredentials: [{ id: 'cred-1', transports: ['usb', 'nfc'] }],
  };

  test('setzt rp (id+name) und user (id base64url, name/displayName)', () => {
    const o = buildRegistrationOptions(params);
    expect(o.rp).toEqual({ id: 'nexora.example', name: 'Nexora SOC' });
    // user.id wird base64url-kodiert (WebAuthn-JSON-Vertrag), Name/DisplayName bleiben.
    expect(o.user).toEqual({
      id: Buffer.from('user-123').toString('base64url'),
      name: 'a@nexora.example', displayName: 'Alice',
    });
    expect(o.challenge).toBe('chal-abc');
  });

  test('bietet ES256 (-7) und RS256 (-257) als pubKeyCredParams', () => {
    const algs = buildRegistrationOptions(params).pubKeyCredParams.map((p) => p.alg);
    expect(algs).toEqual(expect.arrayContaining([-7, -257]));
    buildRegistrationOptions(params).pubKeyCredParams.forEach((p) => expect(p.type).toBe('public-key'));
  });

  test('mappt excludeCredentials (id + transports, type public-key)', () => {
    const ex = buildRegistrationOptions(params).excludeCredentials;
    expect(ex).toEqual([{ type: 'public-key', id: 'cred-1', transports: ['usb', 'nfc'] }]);
  });

  test('Default: attestation none + authenticatorSelection mit userVerification', () => {
    const o = buildRegistrationOptions(params);
    expect(o.attestation).toBe('none');
    expect(o.authenticatorSelection.userVerification).toBe('preferred');
    expect(typeof o.timeout).toBe('number');
  });

  test('excludeCredentials default [] wenn nicht übergeben', () => {
    const o = buildRegistrationOptions({ ...params, excludeCredentials: undefined });
    expect(o.excludeCredentials).toEqual([]);
  });
});

// ── Authentication-Options ────────────────────────────────────────────────────

describe('buildAuthenticationOptions()', () => {
  const params = {
    rpId: 'nexora.example',
    challenge: 'chal-xyz',
    allowCredentials: [{ id: 'cred-1', transports: ['internal'] }],
  };

  test('setzt challenge, rpId und userVerification', () => {
    const o = buildAuthenticationOptions(params);
    expect(o.challenge).toBe('chal-xyz');
    expect(o.rpId).toBe('nexora.example');
    expect(o.userVerification).toBe('preferred');
    expect(typeof o.timeout).toBe('number');
  });

  test('mappt allowCredentials (type public-key, id, transports)', () => {
    const ac = buildAuthenticationOptions(params).allowCredentials;
    expect(ac).toEqual([{ type: 'public-key', id: 'cred-1', transports: ['internal'] }]);
  });

  test('allowCredentials default [] (usernamelos / Passkey-Discovery)', () => {
    const o = buildAuthenticationOptions({ ...params, allowCredentials: undefined });
    expect(o.allowCredentials).toEqual([]);
  });
});

// ── clientData-Prüfung (NACH Signatur — siehe Wiring-Slice) ──────────────────

describe('validateClientDataExpectations()', () => {
  const expected = { type: 'webauthn.create', challenge: 'chal-abc', origin: 'https://nexora.example' };
  const clientData = { type: 'webauthn.create', challenge: 'chal-abc', origin: 'https://nexora.example' };

  test('gültige clientData → { ok: true }', () => {
    expect(validateClientDataExpectations(clientData, expected)).toEqual({ ok: true });
  });

  test('falscher type → ok:false reason type_mismatch', () => {
    const r = validateClientDataExpectations({ ...clientData, type: 'webauthn.get' }, expected);
    expect(r).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  test('falsche challenge → ok:false reason challenge_mismatch (Replay-Schutz)', () => {
    const r = validateClientDataExpectations({ ...clientData, challenge: 'fremd' }, expected);
    expect(r).toEqual({ ok: false, reason: 'challenge_mismatch' });
  });

  test('falsche origin → ok:false reason origin_mismatch (Phishing-Schutz)', () => {
    const r = validateClientDataExpectations({ ...clientData, origin: 'https://evil.example.com' }, expected);
    expect(r).toEqual({ ok: false, reason: 'origin_mismatch' });
  });
});
