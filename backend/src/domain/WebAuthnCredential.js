'use strict';

const { randomUUID } = require('crypto');

/**
 * WebAuthnCredential — ein registrierter FIDO2-Authenticator eines Users
 * (ein User kann mehrere haben). publicKey/credentialId sind per WebAuthn-Design
 * öffentlich (keine Secrets), werden in der Listing-Sicht (toPublicJSON) aber
 * weggelassen — die UI braucht nur Label/Transports/Zeitstempel.
 */
class WebAuthnCredential {
  constructor({
    id           = randomUUID(),
    userId       = '',
    credentialId = '',           // base64url — externer Authenticator-Identifier (unique)
    publicKey    = '',           // base64url COSE public key
    counter      = 0,            // Signatur-Zähler (Clone-Erkennung)
    transports   = [],           // ['usb','nfc','ble','internal','hybrid']
    deviceType   = null,         // 'singleDevice' | 'multiDevice'
    backedUp     = false,
    label        = '',           // nutzerfreundlicher Name
    createdAt    = new Date().toISOString(),
    lastUsedAt   = null,
  } = {}) {
    this.id           = id;
    this.userId       = userId;
    this.credentialId = credentialId;
    this.publicKey    = publicKey;
    this.counter      = counter;
    this.transports   = Array.isArray(transports) ? transports : [];
    this.deviceType   = deviceType;
    this.backedUp     = backedUp;
    this.label        = label;
    this.createdAt    = createdAt;
    this.lastUsedAt   = lastUsedAt;
  }

  /** Listing-sichere Sicht — OHNE credentialId/publicKey (nur Anzeige-Felder). */
  toPublicJSON() {
    return {
      id:         this.id,
      label:      this.label,
      transports: this.transports,
      deviceType: this.deviceType,
      backedUp:   this.backedUp,
      createdAt:  this.createdAt,
      lastUsedAt: this.lastUsedAt,
    };
  }
}

module.exports = { WebAuthnCredential };
