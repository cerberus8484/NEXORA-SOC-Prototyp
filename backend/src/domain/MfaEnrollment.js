'use strict';

const { randomBytes, createHash, randomUUID } = require('crypto');

// MfaEnrollment — eine MFA-Anmeldung (TOTP) pro User.
//
// Sicherheits-Invarianten:
//   - secretEnc (verschlüsseltes TOTP-Secret) wird intern gehalten, aber NIE in toJSON
//   - Recovery-Codes werden NUR als SHA-256-Hash gespeichert; der Klartext wird
//     EINMALIG bei activate() zurückgegeben und ist danach nicht rekonstruierbar
//   - State-Machine: pending → active → disabled (keine Rücksprünge)
//
// Die reversible Verschlüsselung des Secrets liegt bewusst NICHT hier, sondern im
// MfaService (Trennung: Domäne pure + testbar ohne ENV-Schlüssel).

const STATUS = Object.freeze({ PENDING: 'pending', ACTIVE: 'active', DISABLED: 'disabled' });

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5; // → 10 hex-Zeichen pro Code

/** Normalisiert Recovery-Code-Eingabe: nur [a-z0-9], damit Format (Groß/Klein, Bindestriche, Leerzeichen) egal ist. */
function _normalizeRecoveryCode(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _hashRecoveryCode(input) {
  return createHash('sha256').update(_normalizeRecoveryCode(input)).digest('hex');
}

class MfaEnrollment {
  constructor({
    id            = randomUUID(),
    userId,
    status        = STATUS.PENDING,
    secretEnc,
    recoveryCodes = [],
    createdAt     = new Date().toISOString(),
    activatedAt   = null,
    disabledAt    = null,
  } = {}) {
    this.id            = id;
    this.userId        = userId;
    this.status        = status;
    this.secretEnc     = secretEnc;       // verschlüsseltes Secret — niemals nach außen
    this.recoveryCodes = recoveryCodes;   // [{ hash, usedAt }] — niemals nach außen
    this.createdAt     = createdAt;
    this.activatedAt   = activatedAt;
    this.disabledAt    = disabledAt;
  }

  // ── Erstellung ──────────────────────────────────────────────────────────────
  static create({ userId, secretEnc } = {}) {
    if (!userId)    throw new Error('userId ist erforderlich');
    if (!secretEnc) throw new Error('secretEnc (verschlüsseltes Secret) ist erforderlich');
    return new MfaEnrollment({ userId, secretEnc });
  }

  static fromRow(row) {
    return new MfaEnrollment({
      id:            row.id,
      userId:        row.user_id,
      status:        row.status,
      secretEnc:     row.secret_enc,
      recoveryCodes: Array.isArray(row.recovery_codes) ? row.recovery_codes : (row.recovery_codes || []),
      createdAt:     row.created_at,
      activatedAt:   row.activated_at || null,
      disabledAt:    row.disabled_at  || null,
    });
  }

  // ── Übergänge ─────────────────────────────────────────────────────────────────
  /**
   * Verifizierung erfolgreich → aktiviert MFA und erzeugt Recovery-Codes.
   * Gibt die Klartext-Codes EINMALIG zurück (danach nur noch Hashes gespeichert).
   */
  activate() {
    if (this.status !== STATUS.PENDING) {
      throw new Error('activate() nur aus Status pending möglich');
    }
    const plain = [];
    const records = [];
    const seen = new Set();
    while (records.length < RECOVERY_CODE_COUNT) {
      const raw = randomBytes(RECOVERY_CODE_BYTES).toString('hex'); // 10 hex
      if (seen.has(raw)) continue;
      seen.add(raw);
      const display = raw.slice(0, 5) + '-' + raw.slice(5); // xxxxx-xxxxx
      plain.push(display);
      records.push({ hash: _hashRecoveryCode(raw), usedAt: null });
    }
    this.recoveryCodes = records;
    this.status        = STATUS.ACTIVE;
    this.activatedAt   = new Date().toISOString();
    return plain;
  }

  disable() {
    if (this.status === STATUS.DISABLED) return;
    this.status     = STATUS.DISABLED;
    this.disabledAt = new Date().toISOString();
  }

  /** Verbraucht einen Recovery-Code (genau einmal). true = akzeptiert. */
  consumeRecoveryCode(input) {
    const hash = _hashRecoveryCode(input);
    const rec  = this.recoveryCodes.find(r => r.hash === hash && !r.usedAt);
    if (!rec) return false;
    rec.usedAt = new Date().toISOString();
    return true;
  }

  // ── Zustand ──────────────────────────────────────────────────────────────────
  get isActive() {
    return this.status === STATUS.ACTIVE;
  }

  get remainingRecoveryCodes() {
    return this.recoveryCodes.filter(r => !r.usedAt).length;
  }

  // ── Serialisierung — SICHERHEIT: secretEnc + Hashes werden NICHT ausgegeben ───
  toJSON() {
    return {
      id:                     this.id,
      userId:                 this.userId,
      status:                 this.status,
      createdAt:              this.createdAt,
      activatedAt:            this.activatedAt,
      disabledAt:             this.disabledAt,
      recoveryCodesRemaining: this.remainingRecoveryCodes,
      recoveryCodesTotal:     this.recoveryCodes.length,
    };
  }
}

module.exports = { MfaEnrollment, MFA_STATUS: STATUS, RECOVERY_CODE_COUNT };
