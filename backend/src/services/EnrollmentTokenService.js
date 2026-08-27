'use strict';

// ─────────────────────────────────────────────────────────────────────────
// EnrollmentTokenService (P_AGENT_1)
//
// Mint + Authentifizierung von Enrollment-Bootstrap-Tokens.
//
// Sicherheits-Invarianten (analog ApiTokenService):
//   - Klartext-Token wird beim Mint GENAU EINMAL zurückgegeben.
//   - Im Repository liegt nur der SHA-256-Hash (createEnrollmentToken speichert
//     die Domain, deren toJSON() den Hash nie ausgibt).
//   - Klartext-Token erscheint NIE in Audit/Log/Response (Audit-Daten tragen nur
//     prefix + ref-UUID; der ProvisioningAuditEvent lehnt Secret-Keys hart ab).
//   - revoked/expired Token ODER revoked/expired EnrollmentProfile blockieren.
// ─────────────────────────────────────────────────────────────────────────

const { EnrollmentToken, AUDIT_EVENTS } = require('../provisioning/provisioningDomain');
const { NotFoundError, ConflictError } = require('../errors/AppError');

// Plain-Token-Record (ohne Hash) auf Gültigkeit prüfen.
function isRecordActive(rec) {
  if (!rec || rec.revoked) return false;
  if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) return false;
  return true;
}

class EnrollmentTokenService {
  constructor({ repo } = {}) { this._repo = repo || null; }

  _getRepo() {
    if (!this._repo) {
      const { createProvisioningRepository } = require('../repositories/provisioningRepositoryFactory');
      this._repo = createProvisioningRepository();
    }
    return this._repo;
  }

  /**
   * Mint: prüft EnrollmentProfile (muss active sein), erzeugt Token, speichert
   * nur den Hash, auditiert OHNE Token.
   * @returns {{ token: string, enrollmentToken: object }} token ist EINMALIG.
   */
  async mintToken({ enrollmentProfileId, ttlSeconds } = {}) {
    const repo = this._getRepo();
    const profile = await repo.getEnrollmentProfile(enrollmentProfileId);
    if (!profile) throw new NotFoundError('EnrollmentProfile');
    if (profile.status !== 'active') throw new ConflictError(`EnrollmentProfile ist ${profile.status} — kein Token`);

    const { token, domain } = EnrollmentToken.mint({ enrollmentProfileId, ttlSeconds: ttlSeconds || undefined });
    const stored = await repo.createEnrollmentToken(domain);
    await repo.appendAudit({
      type: AUDIT_EVENTS.ENROLLMENT_TOKEN_ISSUED,
      subjectType: 'enrollment', subjectId: enrollmentProfileId,
      data: { ref: stored.id, prefix: stored.prefix }, // kein Token/Hash
    });
    return { token, enrollmentToken: stored };
  }

  /**
   * Authentifiziert einen rohen Enrollment-Token-String.
   * @returns {{ tokenId: string, profile: object } | null}
   * null bei: leer/kein String · unbekannt · revoked/expired Token · Profile nicht active.
   */
  async authenticate(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const repo = this._getRepo();
    const rec = await repo.findEnrollmentTokenByHash(EnrollmentToken.hash(rawToken));
    if (!isRecordActive(rec)) return null;
    const profile = await repo.getEnrollmentProfile(rec.enrollmentProfileId);
    if (!profile || profile.status !== 'active') return null;
    return { tokenId: rec.id, profile };
  }

  /**
   * Verbraucht ein Token nach erfolgreichem Enrollment (Single-Use): setzt es auf
   * revoked, sodass es danach weder erneut enrollen noch als Heartbeat-Credential
   * dienen kann. Auditiert als CONSUMED (semantisch getrennt vom Admin-Revoke).
   */
  async consume(tokenId) {
    const repo = this._getRepo();
    const consumed = await repo.revokeEnrollmentToken(tokenId);
    if (consumed) {
      await repo.appendAudit({
        type: AUDIT_EVENTS.ENROLLMENT_TOKEN_CONSUMED,
        subjectType: 'enrollment', subjectId: consumed.enrollmentProfileId,
        data: { ref: tokenId },
      });
    }
    return consumed;
  }

  /** Widerruft ein Token (Hash bleibt, revoked=true). Auditiert ohne Token. */
  async revokeToken(tokenId) {
    const repo = this._getRepo();
    const revoked = await repo.revokeEnrollmentToken(tokenId);
    if (revoked) {
      await repo.appendAudit({
        type: AUDIT_EVENTS.ENROLLMENT_TOKEN_REVOKED,
        subjectType: 'enrollment', subjectId: revoked.enrollmentProfileId,
        data: { ref: tokenId },
      });
    }
    return revoked;
  }
}

const enrollmentTokenService = new EnrollmentTokenService();

module.exports = { EnrollmentTokenService, enrollmentTokenService, isRecordActive };
