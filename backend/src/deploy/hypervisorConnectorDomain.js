'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Hypervisor-Connector-Domain.
//
// Ein Connector hält die Zugangsdaten zu EINEM Hypervisor (z.B. ein Proxmox-
// Node). Der API-Token wird AES-256-GCM verschlüsselt at-rest gehalten
// (secretsCrypto) und erscheint NIE im toJSON/Log/Return — nur ein nicht-
// geheimer `prefix` zur Identifikation. Entschlüsselung nur transient über
// getApiToken() (vom REST-Connector zur Apply-Zeit).
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { AppError } = require('../errors/AppError');
const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');
const { isKnownConnectorType } = require('./hypervisorConnectorCatalog');

const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'DEPLOY_ERROR');
  e.status = status;
  return e;
}

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw err(`${field} fehlt oder ist leer`);
}

// Nicht-geheimer Hinweis: der Teil VOR '=' (z.B. Proxmox 'user@realm!tokenid') ist die
// Kennung, der Teil danach ist das Geheimnis. Ohne '=' → erste 8 Zeichen. Nie das Secret.
function tokenPrefix(rawToken) {
  const s = String(rawToken || '');
  const eq = s.indexOf('=');
  const head = eq > 0 ? s.slice(0, eq) : s.slice(0, 8);
  return `${head}...`;
}

class HypervisorConnector {
  constructor({
    id = randomUUID(), type, name, host, apiTokenEnc = '', prefix = '', targetNode,
    storage = null, bridge = null, verifyTls = true, tlsCertificatePem = null, tlsCertificateFingerprint = null, status = 'active',
    createdBy = '', createdAt = new Date().toISOString(), updatedAt,
  } = {}) {
    this.id = id; this.type = type; this.name = name; this.host = host;
    this.apiTokenEnc = apiTokenEnc; this.prefix = prefix; this.targetNode = targetNode;
    this.storage = storage; this.bridge = bridge; this.verifyTls = verifyTls; this.tlsCertificatePem = tlsCertificatePem; this.tlsCertificateFingerprint = tlsCertificateFingerprint; this.status = status;
    this.createdBy = String(createdBy || '');
    this.createdAt = createdAt; this.updatedAt = updatedAt || this.createdAt;
  }

  static create({ type, name, host, apiToken, targetNode, storage, bridge, verifyTls, createdBy } = {}) {
    if (!isKnownConnectorType(type)) throw err(`unbekannter Connector-Typ: '${type}' — nicht in der Allowlist`, 400);
    assertNonEmpty(name, 'name');
    assertNonEmpty(host, 'host');
    assertNonEmpty(apiToken, 'apiToken');
    assertNonEmpty(targetNode, 'targetNode');
    const now = new Date().toISOString();
    return new HypervisorConnector({
      id: randomUUID(), type, name: String(name), host: String(host),
      apiTokenEnc: encryptSecret(String(apiToken)),
      prefix: tokenPrefix(apiToken),
      targetNode: String(targetNode),
      storage: storage || null, bridge: bridge || null,
      verifyTls: verifyTls === undefined ? true : Boolean(verifyTls),
      status: 'active', createdBy, createdAt: now, updatedAt: now,
    });
  }

  /** Entschlüsselt den Original-Token — nur transient, nie loggen/zurückgeben. */
  getApiToken() { return decryptSecret(this.apiTokenEnc); }

  get isActive() { return this.status === 'active'; }

  toJSON() {
    // Bewusst OHNE apiToken / apiTokenEnc — nur der nicht-geheime prefix.
    return {
      id: this.id, type: this.type, name: this.name, host: this.host, prefix: this.prefix,
      targetNode: this.targetNode, storage: this.storage, bridge: this.bridge,
      verifyTls: this.verifyTls, status: this.status, createdBy: this.createdBy,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

module.exports = { HypervisorConnector };
