'use strict';

/**
 * webauthnClient.js — Kern der WebAuthn/Passkey-Ceremonies (FIDO2), Slice 1.
 *
 * Reine, netz-freie Logik der "Request-Seite" + clientData-Prüfung:
 *   - Challenge erzeugen (base64url, Replay-Schutz)
 *   - Registration-Options bauen (PublicKeyCredentialCreationOptions)
 *   - Authentication-Options bauen (PublicKeyCredentialRequestOptions)
 *   - clientData-Erwartungen prüfen (type/challenge/origin)
 *
 * WICHTIG (Slice-Grenze): Die kryptografische ATTESTATION-/ASSERTION-Prüfung
 * (Signatur, COSE-Key, Counter, RP-ID-Hash) gehört NICHT hierher — sie folgt im
 * Wiring-Slice über die geprüfte Bibliothek `@simplewebauthn/server` (injiziert,
 * analog zu jose bei OIDC). `validateClientDataExpectations` ist NUR die
 * clientData-Ebene und DARF NIE allein als Verifikation gelten.
 *
 * Routen + Credential-Repo + Migration + UI: spätere Slices.
 */

const crypto = require('crypto');

const CHALLENGE_BYTES   = 32;
const DEFAULT_TIMEOUT_MS = 60_000;
// COSE-Algorithmen: ES256 (-7, am verbreitetsten) + RS256 (-257, Fallback).
const PUB_KEY_CRED_PARAMS = [
  { type: 'public-key', alg: -7 },
  { type: 'public-key', alg: -257 },
];

/** Zufalls-Challenge (base64url) — bindet eine Ceremony an genau diese Anfrage. */
function generateChallenge() {
  return crypto.randomBytes(CHALLENGE_BYTES).toString('base64url');
}

/** Mappt gespeicherte Credentials auf das WebAuthn-Descriptor-Format. */
function toCredentialDescriptors(credentials = []) {
  return credentials.map((c) => ({
    type:       'public-key',
    id:         c.id,
    transports: c.transports || [],
  }));
}

/**
 * Baut die Optionen für die Registration-Ceremony (navigator.credentials.create).
 *
 * @param {{ rpId: string, rpName: string, user: { id: string, name: string, displayName: string },
 *           challenge: string, excludeCredentials?: Array, timeoutMs?: number,
 *           userVerification?: string }} params
 * @returns {object} PublicKeyCredentialCreationOptions (JSON-serialisierbar)
 */
function buildRegistrationOptions({
  rpId, rpName, user, challenge,
  excludeCredentials = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userVerification = 'preferred',
}) {
  return {
    rp:   { id: rpId, name: rpName },
    // user.id (User-Handle) MUSS im JSON base64url sein — der Browser dekodiert es
    // zu Bytes. Die DB-userId (UUID) als opaker Handle base64url-kodiert.
    user: { id: Buffer.from(String(user.id)).toString('base64url'), name: user.name, displayName: user.displayName },
    challenge,
    pubKeyCredParams: PUB_KEY_CRED_PARAMS,
    timeout:     timeoutMs,
    attestation: 'none', // keine Attestation-Privacy-Probleme; Selbstbindung reicht als 2. Faktor
    excludeCredentials: toCredentialDescriptors(excludeCredentials),
    authenticatorSelection: {
      userVerification,
      residentKey:          'preferred',
      requireResidentKey:   false,
    },
  };
}

/**
 * Baut die Optionen für die Authentication-Ceremony (navigator.credentials.get).
 *
 * @param {{ rpId: string, challenge: string, allowCredentials?: Array,
 *           timeoutMs?: number, userVerification?: string }} params
 * @returns {object} PublicKeyCredentialRequestOptions (JSON-serialisierbar)
 */
function buildAuthenticationOptions({
  rpId, challenge,
  allowCredentials = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userVerification = 'preferred',
}) {
  return {
    challenge,
    rpId,
    timeout: timeoutMs,
    userVerification,
    allowCredentials: toCredentialDescriptors(allowCredentials),
  };
}

/**
 * Prüft die clientDataJSON-Erwartungen einer Ceremony. NUR clientData-Ebene —
 * die Signatur-/Attestation-Prüfung MUSS vorher/zusätzlich erfolgen (Wiring-Slice).
 *
 * Gibt { ok: true } oder { ok: false, reason } zurück (nie ein Wurf) — der Aufrufer
 * loggt `reason` serverseitig und liefert nach außen einen einheitlichen Fehler.
 *
 * @param {{ type: string, challenge: string, origin: string }} clientData — geparstes clientDataJSON
 * @param {{ type: string, challenge: string, origin: string }} expected
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateClientDataExpectations(clientData, expected) {
  if (!clientData || typeof clientData !== 'object') return { ok: false, reason: 'no_client_data' };
  if (clientData.type !== expected.type)           return { ok: false, reason: 'type_mismatch' };
  if (clientData.challenge !== expected.challenge) return { ok: false, reason: 'challenge_mismatch' };
  if (clientData.origin !== expected.origin)       return { ok: false, reason: 'origin_mismatch' };
  return { ok: true };
}

module.exports = {
  generateChallenge,
  buildRegistrationOptions,
  buildAuthenticationOptions,
  validateClientDataExpectations,
};
