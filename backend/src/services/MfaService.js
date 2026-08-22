'use strict';

const { MfaEnrollment }                 = require('../domain/MfaEnrollment');
const { generateSecret, verifyToken, otpauthUri } = require('../mfa/totp');
const { encryptSecret, decryptSecret }  = require('../config/secretsCrypto');

// MfaService — verdrahtet Domäne + TOTP-Krypto + Repository.
//
// Verantwortung (SoC):
//   - reversible Verschlüsselung des TOTP-Secrets (at-rest) liegt HIER, nicht in der Domäne
//   - Domäne bleibt damit pur und ohne ENV-Schlüssel testbar
//
// Sicherheit:
//   - Secret verlässt den Service nur EINMAL bei beginEnrollment() (für QR/Manual-Entry)
//   - Recovery-Codes verlassen den Service nur EINMAL bei activate()

class MfaService {
  /**
   * @param {{ save:Function, findByUser:Function, deleteByUser:Function }} [repository]
   * Tests injizieren das Repo direkt. Produktionsbetrieb: Lazy-Init via Factory
   * beim ersten Zugriff (vermeidet dotenv/Config beim Import-Zeitpunkt).
   */
  constructor(repository = null) {
    this._repo = repository;
  }

  _getRepo() {
    if (!this._repo) {
      const { createMfaRepository } = require('../repositories/mfaRepositoryFactory');
      this._repo = createMfaRepository();
    }
    return this._repo;
  }

  /**
   * Startet das Enrollment: erzeugt ein TOTP-Secret, speichert es verschlüsselt
   * als pending-Enrollment und gibt Secret + otpauth-URI EINMALIG zurück.
   */
  async beginEnrollment(userId, { issuer, label } = {}) {
    if (!userId) throw new Error('userId ist erforderlich');

    const existing = await this._getRepo().findByUser(userId);
    if (existing && existing.isActive) {
      throw new Error('MFA ist für diesen Account bereits aktiv');
    }

    const secret     = generateSecret();
    const enrollment = MfaEnrollment.create({ userId, secretEnc: encryptSecret(secret) });
    await this._getRepo().save(enrollment);

    return {
      secret,                                              // Klartext nur hier
      otpauthUri: otpauthUri(secret, { issuer, label: label || userId }),
      enrollment: enrollment.toJSON(),
    };
  }

  /**
   * Verifiziert den ersten TOTP-Code und aktiviert MFA.
   * Gibt die Recovery-Codes EINMALIG im Klartext zurück.
   */
  async activate(userId, token) {
    const enrollment = await this._getRepo().findByUser(userId);
    if (!enrollment) throw new Error('Kein MFA-Enrollment gefunden — bitte zuerst starten');

    const secret = decryptSecret(enrollment.secretEnc);
    if (!secret || !verifyToken(secret, token)) {
      throw new Error('Ungültiger Code');
    }

    const recoveryCodes = enrollment.activate();
    await this._getRepo().save(enrollment);
    return { recoveryCodes, enrollment: enrollment.toJSON() };
  }

  /**
   * Zweiter Faktor beim Login: akzeptiert gültigen TOTP-Code ODER einen
   * (einmaligen) Recovery-Code. Verbraucht den Recovery-Code persistent.
   */
  async verify(userId, code) {
    const enrollment = await this._getRepo().findByUser(userId);
    if (!enrollment || !enrollment.isActive) return false;

    const secret = decryptSecret(enrollment.secretEnc);
    if (secret && verifyToken(secret, code)) return true;

    if (enrollment.consumeRecoveryCode(code)) {
      await this._getRepo().save(enrollment);
      return true;
    }
    return false;
  }

  async disable(userId) {
    const enrollment = await this._getRepo().findByUser(userId);
    if (!enrollment) return;
    enrollment.disable();
    await this._getRepo().save(enrollment);
  }

  async getStatus(userId) {
    const enrollment = await this._getRepo().findByUser(userId);
    if (!enrollment) return { status: 'none' };
    return enrollment.toJSON();
  }
}

// Singleton für Produktionsbetrieb (Lazy-Init beim ersten Repo-Zugriff)
const mfaService = new MfaService();

module.exports = { MfaService, mfaService };
