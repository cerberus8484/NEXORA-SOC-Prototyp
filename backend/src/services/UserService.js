'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { ROLES } = require('../domain/User');
const { NotFoundError, ValidationError } = require('../errors/AppError');
const { validatePassword, pushPasswordHistory }  = require('../domain/passwordPolicy');
const { loadPasswordPolicy, loadPasswordAgingPolicy } = require('../domain/passwordPolicyLoader');
const { resolveBcryptRounds } = require('./AuthService');

// Gleiche Kostenstufe wie beim User-Anlegen (routes/users.js) und Registrierung:
// aus ENV (BCRYPT_ROUNDS), Prod-Floor ≥12, test=4 — zentral in AuthService.
const BCRYPT_ROUNDS = resolveBcryptRounds({ rounds: process.env.BCRYPT_ROUNDS, nodeEnv: process.env.NODE_ENV });

// Länge des temporären Passworts (> 16 Zeichen gefordert).
// Das Passwort wird so konstruiert, dass es jede Komplexitätsstufe erfüllt:
// base64url-Kern (Buchstaben + Ziffern) + Sonderzeichen-Suffix.
const TEMP_PASSWORD_RANDOM_BYTES = 16; // base64url(16 Bytes) = ~22 Zeichen

/**
 * Erzeugt ein kryptografisch zufälliges temporäres Passwort das JEDE Komplexitätsstufe
 * (low / medium / high) bei minLength 8–128 besteht.
 *
 * Aufbau: <base64url-Teil><Großbuchstabe><Ziffer><Sonderzeichen>
 * → Länge ~25 Zeichen, enthält Groß/Klein/Ziffer/Sonderzeichen.
 */
function generateTempPassword() {
  const randomPart = crypto.randomBytes(TEMP_PASSWORD_RANDOM_BYTES).toString('base64url');
  // base64url enthält bereits Buchstaben (Groß+Klein) und Ziffern.
  // Sonderzeichen-Suffix für high-Komplexität:
  return `${randomPart}A1!`;
}

/**
 * UserService — Admin-Benutzerverwaltung.
 *
 * Liest die User-Liste, ändert Rollen, aktiviert/deaktiviert Accounts.
 * Gibt NIEMALS den passwordHash nach außen (toPublicJSON).
 * RBAC (admin-only) wird in der Route via requireRole('admin') erzwungen.
 */
class UserService {
  constructor(userRepository) {
    if (!userRepository) throw new Error('UserService benötigt ein UserRepository');
    this._users = userRepository;
  }

  // Alle User — ohne passwordHash, stabil nach E-Mail sortiert.
  async listUsers() {
    const all = await this._users.findAll();
    return all
      .map((u) => u.toPublicJSON())
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  /**
   * Rolle eines Users setzen. Validiert die Rolle gegen ROLES.
   * Verhindert, dass ein Admin sich selbst die Admin-Rolle entzieht
   * (sonst Lockout-Risiko ohne verbleibenden Admin).
   */
  async setRole({ targetUserId, role, actingUserId }) {
    if (!ROLES.includes(role)) {
      throw new ValidationError(`Unbekannte Rolle '${role}' — erlaubt: ${ROLES.join(', ')}`);
    }
    const user = await this._users.findById(targetUserId);
    if (!user) throw new NotFoundError('Benutzer nicht gefunden');

    if (targetUserId === actingUserId && role !== 'admin') {
      throw new ValidationError('Ein Admin kann sich nicht selbst die Admin-Rolle entziehen');
    }

    user.role      = role;
    user.updatedAt = new Date().toISOString();
    await this._users.save(user);
    return user.toPublicJSON();
  }

  /**
   * Account aktivieren/deaktivieren. Ein Admin kann den eigenen Account
   * nicht deaktivieren (Selbst-Lockout).
   */
  async setActive({ targetUserId, isActive, actingUserId }) {
    if (typeof isActive !== 'boolean') {
      throw new ValidationError('isActive muss ein Boolean sein');
    }
    const user = await this._users.findById(targetUserId);
    if (!user) throw new NotFoundError('Benutzer nicht gefunden');

    if (targetUserId === actingUserId && isActive === false) {
      throw new ValidationError('Der eigene Account kann nicht deaktiviert werden');
    }

    user.isActive  = isActive;
    user.updatedAt = new Date().toISOString();
    await this._users.save(user);
    return user.toPublicJSON();
  }

  /**
   * Setzt für den Ziel-User ein neues, sicheres temporäres Passwort.
   * Gibt das Klartext-Passwort EINMALIG zurück (Aufrufer reicht es genau
   * einmal in der HTTP-Response durch) — es wird nirgends gespeichert oder
   * geloggt. Persistiert wird ausschließlich der bcrypt-Hash.
   *
   * @param {string} id — Ziel-User-ID
   * @returns {Promise<{ user: object, tempPassword: string }>}
   * @throws {NotFoundError} wenn kein User mit dieser ID existiert
   */
  async resetPassword(id) {
    const user = await this._users.findById(id);
    if (!user) throw new NotFoundError('Benutzer nicht gefunden');

    const tempPassword = generateTempPassword();

    // Bisherigen Hash in die History aufnehmen (verhindert spätere Wiederverwendung).
    const { historyCount } = await loadPasswordAgingPolicy();
    user.passwordHistory   = pushPasswordHistory(user.passwordHistory, user.passwordHash, historyCount);
    user.passwordHash      = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    user.passwordChangedAt = new Date().toISOString();
    user.updatedAt         = new Date().toISOString();
    await this._users.save(user);

    return { user: user.toPublicJSON(), tempPassword };
  }
}

module.exports = { UserService };
