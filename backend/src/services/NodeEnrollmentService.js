'use strict';

// ─────────────────────────────────────────────────────────────────────────
// NodeEnrollmentService (P_AGENT_1)
//
// Enrollment + Heartbeat-Aufnahme auf Basis des persistenten Provisioning-
// Modells. **Liefert NIEMALS Commands/Apply/Remote-Anweisungen aus.** Es gibt
// keine Methode, die Netzwerk/Firewall/NAT/DHCP/Routing ändert oder Befehle
// ausführt — nur Zustands-Updates + Beobachtung (Heartbeat/Capabilities).
//
// Repository ausschließlich über die provisioningRepositoryFactory (kein
// Sonder-Storage, respektiert DB_ENABLED).
// ─────────────────────────────────────────────────────────────────────────

const { CAPABILITIES, HEARTBEAT_STATUS } = require('../provisioning/provisioningDomain');
const { UnauthorizedError, NotFoundError, ValidationError, ForbiddenError } = require('../errors/AppError');

// Nur erlaubte (read-only) Capabilities übernehmen, dedupliziert.
function mergeCapabilities(profileCaps = [], reportedCaps = []) {
  const all = [
    ...(Array.isArray(profileCaps) ? profileCaps : []),
    ...(Array.isArray(reportedCaps) ? reportedCaps : []),
  ];
  return [...new Set(all.filter((c) => CAPABILITIES.includes(c)))];
}

function firstIp(ips, fallback = null) {
  return Array.isArray(ips) && ips.length ? String(ips[0]) : fallback;
}

class NodeEnrollmentService {
  constructor({ repo, tokenService, credentialService } = {}) {
    this._repo = repo || null;
    this._tokenService = tokenService || null;
    this._credentialService = credentialService || null;
  }

  _getRepo() {
    if (!this._repo) {
      this._repo = require('../repositories/provisioningRepositoryFactory').createProvisioningRepository();
    }
    return this._repo;
  }
  _getTokenService() {
    if (!this._tokenService) {
      this._tokenService = require('./EnrollmentTokenService').enrollmentTokenService;
    }
    return this._tokenService;
  }
  _getCredentialService() {
    if (!this._credentialService) {
      this._credentialService = require('./NodeCredentialService').nodeCredentialService;
    }
    return this._credentialService;
  }

  /**
   * Enroll: Token validieren → InstalledNode anlegen/aktualisieren → enrolled →
   * Capabilities speichern → Audit (über Repo). Antwort: { nodeId, serverTime }.
   * KEINE Commands, KEIN Apply, KEINE Netzwerkaktion.
   */
  async enroll({ token, hostname, platform, version, ips, capabilities } = {}) {
    const auth = await this._getTokenService().authenticate(token);
    if (!auth) throw new UnauthorizedError('Enrollment-Token ungültig, abgelaufen oder widerrufen');
    if (!hostname || typeof hostname !== 'string' || !hostname.trim()) {
      throw new ValidationError('hostname fehlt oder ist leer');
    }

    const repo = this._getRepo();
    const role = auth.profile.role;
    const ip = firstIp(ips);

    let node = await repo.findNodeByName(hostname);
    if (!node) {
      node = await repo.createNode({ name: hostname, role, os: platform || null, version: version || null, ip });
    } else {
      node = await repo.updateNode(node.id, {
        ip: ip || node.ip,
        os: platform || node.os,
        version: version || node.version,
      });
    }

    if (node.status === 'pending') node = await repo.transitionNode(node.id, 'enrolled');

    for (const cap of mergeCapabilities(auth.profile.capabilities, capabilities)) {
      await repo.reportCapability({ nodeId: node.id, name: cap });
    }

    // Single-Use ATOMAR durchsetzen: den Enrollment-Token ZUERST verbrauchen,
    // erst dann das Credential minten. consume() ist ein Compare-and-Set
    // (revoke nur wenn noch aktiv) → gewinnt ein paralleler Enroll das Rennen
    // nicht, liefert consume() null und es entsteht KEIN zweites Credential.
    const consumed = await this._getTokenService().consume(auth.tokenId);
    if (!consumed) throw new UnauthorizedError('Enrollment-Token bereits verbraucht');

    // Node-Credential ausgeben (Klartext EINMALIG) — das ist das Betriebs-Credential
    // für Heartbeats; der Enrollment-Token taugt danach für nichts mehr.
    const { credential } = await this._getCredentialService().mintForNode(node.id);

    return { nodeId: node.id, nodeCredential: credential, serverTime: new Date().toISOString() };
  }

  /**
   * Server-seitige Registrierung eines frisch deployten Nodes — KEIN Enrollment-Token
   * (der Deploy WEISS, dass der Node existiert, sobald er 'deployed' ist). Upsert per
   * Name (idempotent bei Re-Deploy), pending→enrolled, Capabilities. Kein Credential-Mint
   * (das läuft weiter über den Agent-Pull-`enroll`, wenn der Agent selbst heartbeatet).
   * @returns {object} der (upsertete) InstalledNode
   */
  async registerInstalledNode({ hostname, role, os = null, ip = null, version = null, capabilities = [], hostKeyPin = null } = {}) {
    if (!hostname || typeof hostname !== 'string' || !hostname.trim()) {
      throw new ValidationError('hostname fehlt oder ist leer');
    }
    const repo = this._getRepo();
    let node = await repo.findNodeByName(hostname);
    if (!node) {
      node = await repo.createNode({ name: hostname, role, os, version, ip, hostKeyPin });
    } else {
      // hostKeyPin nur setzen, wenn übergeben — ein bereits erfasster Pin wird nicht mit null überschrieben.
      node = await repo.updateNode(node.id, { ip: ip || node.ip, os: os || node.os, version: version || node.version, hostKeyPin: hostKeyPin || node.hostKeyPin });
    }
    if (node.status === 'pending') node = await repo.transitionNode(node.id, 'enrolled');
    for (const cap of (Array.isArray(capabilities) ? capabilities : [])) {
      await repo.reportCapability({ nodeId: node.id, name: cap });
    }
    return node;
  }

  /**
   * Heartbeat: Node muss existieren → Heartbeat speichern → lastSeen/Status/
   * Version aktualisieren → Capabilities → Audit (über Repo). Antwort enthält nur
   * accepted/serverTime + rein informativ desiredProfileId. KEINE Commands/Apply.
   */
  async recordHeartbeat(nodeId, { status, version, ips, observedAt, capabilities } = {}) {
    const repo = this._getRepo();
    const node = await repo.getNode(nodeId);
    if (!node) throw new NotFoundError('Node');
    // Defense-in-Depth: ein stillgelegter (retired) Node nimmt keine Heartbeats mehr
    // an — auch nicht, falls ein Credential fälschlich noch gültig wäre. Im Normalfall
    // greift schon der Credential-Widerruf (Route → 401); dies ist die Service-Schicht.
    if (node.status === 'retired') throw new ForbiddenError('Node ist stillgelegt (retired) — keine Heartbeats');

    const hbStatus = HEARTBEAT_STATUS.includes(status) ? status : 'healthy';
    await repo.recordHeartbeat({ nodeId, status: hbStatus, agentVersion: version || null });

    await repo.updateNode(nodeId, {
      lastSeenAt: observedAt || new Date().toISOString(),
      version: version || node.version,
      ip: firstIp(ips, node.ip),
    });

    // Erster Heartbeat nach Enrollment → aktiv.
    const fresh = await repo.getNode(nodeId);
    if (fresh && fresh.status === 'enrolled') await repo.transitionNode(nodeId, 'active');

    for (const cap of mergeCapabilities([], capabilities)) {
      await repo.reportCapability({ nodeId, name: cap });
    }

    // Bewusst NUR Informations-Felder — keine Befehle/Apply-Anweisungen.
    return { accepted: true, serverTime: new Date().toISOString(), desiredProfileId: node.profileId || null };
  }

  /**
   * Node stilllegen (retire). **Revoke-on-retire:** widerruft ZUERST alle aktiven
   * Node-Credentials (jeder Revoke auditiert NODE_CREDENTIAL_REVOKED ohne Secret),
   * DANN den terminalen Statuswechsel auf 'retired' (auditiert NODE_RETIRED). Die
   * Reihenfolge schließt das Fenster, in dem ein retired Node noch heartbeaten könnte.
   * Idempotent durch das Compare-and-Set in revokeNodeCredential. KEINE Netz-/Apply-Aktion.
   * @returns {{ nodeId: string, revokedCredentials: number }}
   */
  async retireNode(nodeId, reason = null) {
    const repo = this._getRepo();
    const node = await repo.getNode(nodeId);
    if (!node) throw new NotFoundError('Node');

    const credentialService = this._getCredentialService();
    const creds = await repo.listNodeCredentials(nodeId);
    let revokedCredentials = 0;
    for (const c of creds) {
      if (c.status !== 'active') continue;
      const revoked = await credentialService.revoke(c.id, reason || 'node_retired');
      if (revoked) revokedCredentials += 1;
    }

    await repo.transitionNode(nodeId, 'retired');
    return { nodeId, revokedCredentials };
  }
}

// ACHTUNG: Dieses Singleton ist NUR ein Bequemlichkeits-Fallback. Es nutzt die
// lazy-initialisierten Service-/Repo-Singletons — die im InMemory-Modus einen
// EIGENEN, isolierten Store haben. Produktiv IMMER eine geteilte repo-Instanz in
// alle drei Services injizieren (siehe routes/provisioning.js), nie dieses
// Singleton direkt für Enrollment nutzen.
const nodeEnrollmentService = new NodeEnrollmentService();

module.exports = { NodeEnrollmentService, nodeEnrollmentService, mergeCapabilities };
