'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Deployment Center — SSH-Deploy-Connector (agent-install / Brownfield).
//
// Hält die SSH-Zugangsdaten für EINEN Ziel-Host: privateKey (+ optionale passphrase)
// werden AES-256-GCM at-rest verschlüsselt (secretsCrypto) und erscheinen NIE im
// toJSON/Row-Public/Log — nur transient über getPrivateKey()/getPassphrase() zur
// Apply-Zeit (beim Bau des SSH-Runners). `hostKeyPin` ist der SHA-256-Fingerprint des
// erwarteten Server-Host-Keys (öffentlich, KEIN Secret) → Host-Key-Pinning fail-closed.
//
// Bewusst EIN Host je Connector: der Connector autorisiert genau seinen `host`
// (allowedHosts=[host]); ein Spec, das einen anderen targetHost anfährt, wird vom
// Runner abgelehnt. Das hält den gepinnten Host-Key exakt am Ziel.
// ─────────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { AppError } = require('../errors/AppError');
const { encryptSecret, decryptSecret, isEncrypted } = require('../config/secretsCrypto');

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;   // IP/DNS, keine Shell-Metazeichen
// SSH-Username: POSIX (root, deploy) UND Windows (Administrator, nexora-svc). Injektionssicher
// (kein Space/Quote/Metazeichen); der Wert ist ein ssh2-Protokollfeld, keine Shell-Interpolation.
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const PIN_RE  = /^[a-f0-9]{64}$/i;          // SHA-256 des Host-Keys als Hex

const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'DEPLOY_SSH_CONNECTOR_ERROR');
  e.status = status;
  return e;
}

class SshDeployConnector {
  constructor({
    id = randomUUID(), type = 'ssh', name, host, sshUser = 'root', sshPort = 22,
    hostKeyPin, privateKeyEnc = '', passphraseEnc = '', status = 'active',
    createdBy = '', createdAt = new Date().toISOString(), updatedAt,
  } = {}) {
    this.id = id; this.type = type; this.name = name; this.host = host;
    this.sshUser = sshUser; this.sshPort = sshPort; this.hostKeyPin = hostKeyPin;
    this.privateKeyEnc = privateKeyEnc; this.passphraseEnc = passphraseEnc;
    this.status = status; this.createdBy = String(createdBy || '');
    this.createdAt = createdAt; this.updatedAt = updatedAt || this.createdAt;
  }

  static create({ name, host, sshUser, sshPort, privateKey, passphrase, hostKeyPin, createdBy } = {}) {
    if (typeof name !== 'string' || name.trim() === '') throw err('name fehlt oder ist leer');
    if (!HOST_RE.test(String(host || ''))) throw err('ungültiger host (IP/DNS erwartet)');
    const user = sshUser == null || sshUser === '' ? 'root' : String(sshUser);
    if (!USER_RE.test(user)) throw err('ungültiger sshUser');
    const port = sshPort == null ? 22 : sshPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw err('ungültiger sshPort');
    if (!PIN_RE.test(String(hostKeyPin || ''))) throw err('ungültiger hostKeyPin (SHA-256-Hex erwartet)');
    if (typeof privateKey !== 'string' || privateKey.trim() === '') throw err('privateKey fehlt oder ist leer');

    const now = new Date().toISOString();
    return new SshDeployConnector({
      id: randomUUID(), type: 'ssh', name: String(name), host: String(host),
      sshUser: user, sshPort: port, hostKeyPin: String(hostKeyPin).toLowerCase(),
      privateKeyEnc: encryptSecret(String(privateKey)),
      passphraseEnc: passphrase ? encryptSecret(String(passphrase)) : '',
      status: 'active', createdBy, createdAt: now, updatedAt: now,
    });
  }

  /** Transiente Entschlüsselung — nur zur Apply-Zeit, nie loggen/zurückgeben.
   *  Defensiv: ein nicht-leerer, aber NICHT verschlüsselter Wert (z.B. versehentlich
   *  als Klartext persistiert) wird abgelehnt (fail-closed) statt still akzeptiert. */
  getPrivateKey() {
    if (this.privateKeyEnc && !isEncrypted(this.privateKeyEnc)) {
      throw err('privateKey ist nicht verschlüsselt gespeichert — abgelehnt (fail-closed)');
    }
    return decryptSecret(this.privateKeyEnc);
  }
  getPassphrase() {
    if (!this.passphraseEnc) return null;
    if (!isEncrypted(this.passphraseEnc)) throw err('passphrase ist nicht verschlüsselt gespeichert — abgelehnt (fail-closed)');
    const p = decryptSecret(this.passphraseEnc);
    return p === '' ? null : p;
  }

  get isActive() { return this.status === 'active'; }

  /** Öffentliche Sicht — bewusst OHNE privateKeyEnc/passphraseEnc. hostKeyPin ist öffentlich. */
  toJSON() {
    return {
      id: this.id, type: this.type, name: this.name, host: this.host,
      sshUser: this.sshUser, sshPort: this.sshPort, hostKeyPin: this.hostKeyPin,
      status: this.status, createdBy: this.createdBy, createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }

  /** Persistenz-Sicht fürs Repo — enthält die verschlüsselten Felder (nie den Klartext). */
  toRow() {
    return { ...this.toJSON(), privateKeyEnc: this.privateKeyEnc, passphraseEnc: this.passphraseEnc };
  }
}

module.exports = { SshDeployConnector };
