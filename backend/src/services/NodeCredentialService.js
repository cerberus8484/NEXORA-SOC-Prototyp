'use strict';

// ─────────────────────────────────────────────────────────────────────────
// NodeCredentialService (P_INSTALL_1 Slice 2)
//
// Verwaltet das langlebige Betriebs-Credential einer Node (für Heartbeats).
//
// Sicherheits-Invarianten (analog EnrollmentTokenService):
//   - Klartext-Credential wird beim Mint GENAU EINMAL zurückgegeben.
//   - Im Repository liegt nur der SHA-256-Hash.
//   - Klartext erscheint NIE in Audit/Log/Response (außer der einmaligen
//     Enrollment-Response, die der Aufrufer zurückgibt).
//   - authenticate() gibt nie das Domain-Objekt zurück — nur { nodeId, credentialId }.
// ─────────────────────────────────────────────────────────────────────────

const { NodeCredential, AUDIT_EVENTS } = require('../provisioning/provisioningDomain');

function isRecordActive(rec) {
  return Boolean(rec) && rec.status === 'active';
}

class NodeCredentialService {
  constructor({ repo } = {}) { this._repo = repo || null; }

  _getRepo() {
    if (!this._repo) {
      const { createProvisioningRepository } = require('../repositories/provisioningRepositoryFactory');
      this._repo = createProvisioningRepository();
    }
    return this._repo;
  }

  /**
   * Mintet ein neues Node-Credential und speichert nur dessen Hash.
   * @returns {{ credential: string, nodeCredential: object }} credential EINMALIG.
   */
  async mintForNode(nodeId) {
    const repo = this._getRepo();
    const { credential, domain } = NodeCredential.mint({ nodeId });
    const stored = await repo.createNodeCredential(domain);
    await repo.appendAudit({
      type: AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED,
      subjectType: 'node', subjectId: String(nodeId),
      data: { ref: stored.id, prefix: stored.prefix }, // kein Klartext/Hash
    });
    return { credential, nodeCredential: stored };
  }

  /**
   * Authentifiziert ein rohes Node-Credential.
   * @returns {{ nodeId: string, credentialId: string } | null}
   * null bei: leer/kein String · unbekannt · revoked. Ein Enrollment-Token
   * (anderer Hash-Raum) findet hier nichts → wird nie als Node-Credential akzeptiert.
   */
  async authenticate(rawCredential) {
    if (!rawCredential || typeof rawCredential !== 'string') return null;
    const repo = this._getRepo();
    const rec = await repo.findNodeCredentialByHash(NodeCredential.hash(rawCredential));
    if (!isRecordActive(rec)) return null;
    // lastUsedAt best-effort aktualisieren (kein await-Block für die Antwort).
    // Bewusst verschluckt: ein fehlgeschlagenes lastUsedAt darf die Auth nie blockieren.
    if (typeof repo.touchNodeCredential === 'function') repo.touchNodeCredential(rec.id).catch(() => { /* best-effort, intentionally ignored */ });
    return { nodeId: rec.nodeId, credentialId: rec.id };
  }

  /** Widerruft ein Node-Credential. Auditiert ohne Credential-Material. */
  async revoke(credentialId, reason = null) {
    const repo = this._getRepo();
    const revoked = await repo.revokeNodeCredential(credentialId, reason);
    if (revoked) {
      await repo.appendAudit({
        type: AUDIT_EVENTS.NODE_CREDENTIAL_REVOKED,
        subjectType: 'node', subjectId: revoked.nodeId,
        data: { ref: credentialId },
      });
    }
    return revoked;
  }
}

const nodeCredentialService = new NodeCredentialService();

module.exports = { NodeCredentialService, nodeCredentialService, isRecordActive };
