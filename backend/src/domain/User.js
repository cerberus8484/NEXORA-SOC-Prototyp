'use strict';

const { randomUUID } = require('crypto');

const ROLES = ['admin', 'engineer', 'analyst', 'viewer'];

class User {
  constructor({
    id           = randomUUID(),
    email        = '',
    displayName  = '',
    passwordHash = '',
    role         = 'analyst',
    isActive     = true,
    lastLoginAt  = null,
    createdAt    = new Date().toISOString(),
    updatedAt    = new Date().toISOString(),
    phone        = '',
    theme        = '',
    language     = 'en',
    dateFormat   = 'dmy',
    passwordChangedAt = null,
    passwordHistory   = [],
    mustChangePassword = false,
    oidcSub      = null,
    oidcProvider = null,
  } = {}) {
    this.id           = id;
    this.email        = email.toLowerCase().trim();
    this.displayName  = displayName;
    this.passwordHash = passwordHash;
    this.role         = role;
    this.isActive     = isActive;
    this.lastLoginAt  = lastLoginAt;
    this.createdAt    = createdAt;
    this.updatedAt    = updatedAt;
    this.phone        = phone;
    this.theme        = theme;
    // Self-Service-Präferenzen: UI-Sprache + Datumsformat (kein PII, rein Anzeige).
    this.language     = language;
    this.dateFormat   = dateFormat;
    // Passwort-Aging (Welle 2): Zeitpunkt der letzten Änderung + Hash-History.
    this.passwordChangedAt = passwordChangedAt;
    this.passwordHistory   = Array.isArray(passwordHistory) ? passwordHistory : [];
    // Erst-Login-Zwang (Easy-Install): muss beim ersten Login gewechselt werden.
    // Getrennt vom Ablauf (passwordChangedAt) — Erstanmeldung ≠ regulärer Ablauf.
    this.mustChangePassword = mustChangePassword === true;
    // SSO / OIDC (Welle 3): externe Identitätsbindung. Null = nur Passwort-Login.
    // provider = IdP-issuer, sub = stabiler IdP-Subject-Identifier. Nie nach außen.
    this.oidcSub      = oidcSub      ?? null;
    this.oidcProvider = oidcProvider ?? null;
  }

  // Niemals den password_hash ODER die Hash-History in API-Responses exponieren.
  // Auch die OIDC-Identitätsbindung (sub/provider) bleibt serverintern.
  toPublicJSON() {
    // eslint-disable-next-line no-unused-vars
    const { passwordHash, passwordHistory, oidcSub, oidcProvider, ...pub } = this;
    return pub;
  }

  toJSON() {
    return this.toPublicJSON(); // JSON.stringify gibt niemals den Hash raus
  }
}

module.exports = { User, ROLES };
