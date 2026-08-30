'use strict';

/**
 * webAuthnService.js — Orchestrierung der WebAuthn/Passkey-Ceremonies (Slice 2b).
 *
 * Netz-/krypto-frei: die kryptografische Verifikation (verifyRegistration/
 * verifyAuthentication) wird INJIZIERT — im Boot-Wiring (webAuthnInstance.js)
 * über `@simplewebauthn/server`. Die Request-Seite (Options + Challenge) baut der
 * reine `webauthnClient` (Slice 1). Gleicher Split wie OIDC (Client + jose).
 *
 * SICHERHEIT (OWASP A07):
 *   - Registration: speichert ein Credential NUR bei `verified === true`.
 *   - Authentication: einheitlicher, nicht-diskriminierender Fehler für ALLE
 *     Fehlerpfade (unbekannt/inaktiv/nicht-verifiziert/Clone) — der konkrete
 *     Grund wird ausschließlich serverseitig geloggt, nie an den Client.
 *   - Counter-Clone-Erkennung: neuer Signatur-Zähler muss steigen (außer beide 0).
 *   - Inaktive User werden abgewiesen.
 */

const logger = require('../../logger');
const { WebAuthnCredential } = require('../../domain/WebAuthnCredential');
const defaultClient = require('./webauthnClient');

const WEBAUTHN_FAILED_MESSAGE = 'Anmeldung mit Sicherheitsschlüssel fehlgeschlagen.';

/** Fehler im WebAuthn-Flow. `reason` ist intern (nur Server-Log). */
class WebAuthnError extends Error {
  constructor(reason) {
    super(WEBAUTHN_FAILED_MESSAGE);
    this.name = 'WebAuthnError';
    this.reason = reason;
  }
}

class WebAuthnService {
  /**
   * @param {object}   deps
   * @param {object}   deps.config — config.webauthn { enabled, rpId, rpName, origin, timeoutMs }
   * @param {object}   deps.credentialRepo — WebAuthn-Credential-Repository
   * @param {object}   deps.userRepository — findById
   * @param {object}   deps.authService — _issueSession(user)
   * @param {Function} deps.verifyRegistration   — async ({response, expectedChallenge, expectedOrigin, expectedRPID}) => { verified, credential }
   * @param {Function} deps.verifyAuthentication — async ({response, expectedChallenge, expectedOrigin, expectedRPID, credential}) => { verified, newCounter }
   * @param {object}  [deps.client] — webauthnClient-Modul (Default: das echte)
   */
  constructor({ config, credentialRepo, userRepository, authService, verifyRegistration, verifyAuthentication, client }) {
    this._config              = config;
    this._credentialRepo      = credentialRepo;
    this._userRepository      = userRepository;
    this._authService         = authService;
    this._verifyRegistration  = verifyRegistration;
    this._verifyAuthentication = verifyAuthentication;
    this._client              = client || defaultClient;
  }

  /** Startet die Registrierung eines neuen Authenticators (User ist eingeloggt). */
  async beginRegistration(user) {
    const existing = await this._credentialRepo.findByUserId(user.id);
    const challenge = this._client.generateChallenge();
    const options = this._client.buildRegistrationOptions({
      rpId:   this._config.rpId,
      rpName: this._config.rpName,
      user:   { id: user.id, name: user.email, displayName: user.displayName || user.email },
      challenge,
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
      timeoutMs: this._config.timeoutMs,
    });
    return { options, flow: { challenge, userId: user.id, type: 'registration' } };
  }

  /** Schließt die Registrierung ab: verifiziert die Attestation, speichert das Credential. */
  async finishRegistration({ flow, response, label }) {
    if (!this._config.enabled) throw new WebAuthnError('gate_disabled');

    const result = await this._verifyRegistration({
      response,
      expectedChallenge: flow.challenge,
      expectedOrigin:    this._config.origin,
      expectedRPID:      this._config.rpId,
    });
    if (!result || !result.verified || !result.credential) {
      throw new WebAuthnError('registration_not_verified');
    }

    const info = result.credential;
    const credential = new WebAuthnCredential({
      userId:       flow.userId,
      credentialId: info.credentialId,
      publicKey:    info.publicKey,
      counter:      info.counter || 0,
      transports:   info.transports || [],
      deviceType:   info.deviceType || null,
      backedUp:     Boolean(info.backedUp),
      label:        label || '',
    });
    await this._credentialRepo.create(credential);
    return credential.toPublicJSON();
  }

  /** Startet die Anmeldung per Passkey (usernamelos — Authenticator wählt). */
  async beginAuthentication() {
    const challenge = this._client.generateChallenge();
    const options = this._client.buildAuthenticationOptions({
      rpId:      this._config.rpId,
      challenge,
      allowCredentials: [],
      timeoutMs: this._config.timeoutMs,
    });
    return { options, flow: { challenge, type: 'authentication' } };
  }

  /**
   * Schließt die Anmeldung ab: Credential auflösen → Assertion verifizieren →
   * Counter-Clone-Check → Counter aktualisieren → Session ausstellen.
   * Einheitlicher Fehler für alle Fehlerpfade.
   */
  async finishAuthentication({ flow, response }) {
    if (!this._config.enabled) return this._fail('gate_disabled');

    const credentialId = response && response.id;
    if (!credentialId) return this._fail('no_credential_id');

    const stored = await this._credentialRepo.findByCredentialId(credentialId);
    if (!stored) return this._fail('unknown_credential');

    let result;
    try {
      result = await this._verifyAuthentication({
        response,
        expectedChallenge: flow.challenge,
        expectedOrigin:    this._config.origin,
        expectedRPID:      this._config.rpId,
        credential: {
          credentialId: stored.credentialId,
          publicKey:    stored.publicKey,
          counter:      stored.counter,
          transports:   stored.transports,
        },
      });
    } catch {
      return this._fail('verify_error');
    }
    if (!result || !result.verified) return this._fail('not_verified');

    // Clone-Erkennung: der Signatur-Zähler muss steigen (außer der Authenticator
    // führt keinen Zähler → beide 0).
    const newCounter = result.newCounter ?? 0;
    if (stored.counter > 0 && newCounter <= stored.counter) return this._fail('counter_clone');

    await this._credentialRepo.updateCounter(stored.credentialId, newCounter);

    const user = await this._userRepository.findById(stored.userId);
    if (!user || !user.isActive) return this._fail('user_missing_or_inactive');

    return this._authService._issueSession(user);
  }

  /** Einheitlicher Fehlschlag: gleiche Meldung für jeden Grund; Grund nur ins Log. */
  _fail(reason) {
    logger.warn('webauthn_login_failed', { reason });
    throw new WebAuthnError(reason);
  }
}

module.exports = { WebAuthnService, WebAuthnError };
