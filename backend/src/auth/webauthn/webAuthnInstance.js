'use strict';

/**
 * webAuthnInstance.js — Boot-Wiring des WebAuthn-Logins (Slice 2c).
 *
 * Hier (und NUR hier) lebt die echte Krypto: `@simplewebauthn/server` verifiziert
 * Attestation (Registrierung) + Assertion (Anmeldung). Lazy require (CommonJS-
 * requirebar, aber nur im echten Flow nötig) → Jest/Imports berühren die Lib nie.
 * Der WebAuthnService selbst bleibt dadurch netz-/krypto-frei + unit-testbar.
 *
 * Adapter: die Lib spricht in Uint8Array (publicKey) + `{id,publicKey,counter}`;
 * wir speichern base64url-Strings. Diese Schicht übersetzt beide Richtungen und
 * mappt die Lib-Ausgabe auf die schlanke Service-Shape ({verified, credential} /
 * {verified, newCounter}).
 *
 * Geteilte Repo-/User-Instanzen mit dem AuthService: in beiden Persistenz-Modi
 * müssen Credential-Lookup, User-Auflösung und _issueSession auf DENSELBEN Store
 * wirken (dokumentierte Repo-Instanz-Falle).
 */

const config = require('../../config');
const { authService } = require('../../services/AuthService');
const { createWebAuthnCredentialRepository } = require('../../repositories/webAuthnCredentialRepositoryFactory');
const { WebAuthnService } = require('./webAuthnService');

let _lib = null;
function lib() {
  if (!_lib) _lib = require('@simplewebauthn/server');
  return _lib;
}

const u8ToB64url = (u8) => Buffer.from(u8).toString('base64url');
const b64urlToU8 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

/** Verifiziert die Registrierungs-Attestation → schlanke Service-Shape. */
async function verifyRegistration({ response, expectedChallenge, expectedOrigin, expectedRPID }) {
  const res = await lib().verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
  });
  if (!res.verified || !res.registrationInfo) return { verified: false };
  const c = res.registrationInfo.credential;
  return {
    verified: true,
    credential: {
      credentialId: c.id,                       // base64url-String
      publicKey:    u8ToB64url(c.publicKey),    // Uint8Array → base64url
      counter:      c.counter,
      transports:   c.transports || [],
      deviceType:   res.registrationInfo.credentialDeviceType,
      backedUp:     res.registrationInfo.credentialBackedUp,
    },
  };
}

/** Verifiziert die Anmelde-Assertion → { verified, newCounter }. */
async function verifyAuthentication({ response, expectedChallenge, expectedOrigin, expectedRPID, credential }) {
  const res = await lib().verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    credential: {
      id:         credential.credentialId,
      publicKey:  b64urlToU8(credential.publicKey),  // base64url → Uint8Array
      counter:    credential.counter,
      transports: credential.transports,
    },
    requireUserVerification: false,
  });
  return { verified: res.verified === true, newCounter: res.authenticationInfo?.newCounter ?? 0 };
}

// Geteilte Credential-Repo-Instanz (alle Routen/Service auf DENSELBEN Store).
const credentialRepo = createWebAuthnCredentialRepository();

const webAuthnService = new WebAuthnService({
  config:         config.webauthn,
  credentialRepo,
  userRepository: authService._users,   // exakt die User-Repo-Instanz des AuthService
  authService,
  verifyRegistration,
  verifyAuthentication,
});

module.exports = { webAuthnService, credentialRepo };
