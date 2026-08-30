'use strict';

// ─────────────────────────────────────────────────────────────────────────
// InMemoryProvisioningRepository (P_PROVISION_1)
//
// In-Memory-Speicher für das Provisioning-Domain-Model (Tests/Dev, DB_ENABLED=false).
// Postgres-Implementierung folgt später per Domänen-Factory (wie im Rest).
//
// **Rein Zustand.** Es gibt KEINE Methode, die Netzwerk/DHCP/NAT/Routing/Firewall
// ändert oder Remote-Befehle ausführt — Apply ist nicht Teil dieses Modells.
// Audit-Events sind append-only (kein update/delete).
// ─────────────────────────────────────────────────────────────────────────

const {
  ProvisioningProfile, EnrollmentProfile, EnrollmentToken, NodeCredential, InstalledNode,
  NodeCapability, NodeHeartbeat, ProvisioningAuditEvent,
  AUDIT_EVENTS,
} = require('../provisioning/provisioningDomain');

function page(items, limit, offset) {
  return { data: items.slice(offset, offset + limit).map((x) => x.toJSON()), total: items.length };
}
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

class InMemoryProvisioningRepository {
  constructor() {
    this._profiles     = new Map();
    this._enrollments  = new Map();
    this._nodes        = new Map();
    this._capabilities = []; // NodeCapability[]
    this._heartbeats   = []; // NodeHeartbeat[]
    this._audit        = []; // ProvisioningAuditEvent[] — append-only
    this._tokens       = new Map(); // id → EnrollmentToken (enthält nur Hash)
    this._tokenByHash  = new Map(); // tokenHash → id
    this._credentials  = new Map(); // id → NodeCredential (enthält nur Hash)
    this._credByHash   = new Map(); // credentialHash → id
  }

  // ─── Audit (append-only) ──────────────────────────────────────────────────
  async appendAudit(input) {
    const ev = ProvisioningAuditEvent.create(input); // validiert + lehnt Secrets ab
    this._audit.push(ev);
    return ev.toJSON();
  }
  async listAudit({ type, subjectId, limit = 100, offset = 0 } = {}) {
    let all = this._audit.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    if (type)      all = all.filter((e) => e.type === type);
    if (subjectId) all = all.filter((e) => e.subjectId === subjectId);
    return { data: all.slice(offset, offset + limit).map((e) => e.toJSON()), total: all.length };
  }

  // ─── ProvisioningProfile ──────────────────────────────────────────────────
  async createProfile(data) {
    const p = ProvisioningProfile.create(data);
    this._profiles.set(p.id, p);
    await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_CREATED, subjectType: 'profile', subjectId: p.id, actor: data.createdBy || null });
    return p.toJSON();
  }
  async getProfile(id) { const p = this._profiles.get(id); return p ? p.toJSON() : null; }
  async listProfiles({ limit = 50, offset = 0 } = {}) { return page([...this._profiles.values()].sort(newestFirst), limit, offset); }
  async updateProfile(id, patch) {
    const p = this._profiles.get(id); if (!p) return null;
    const u = p.update(patch); this._profiles.set(id, u); return u.toJSON();
  }
  async transitionProfile(id, status) {
    const p = this._profiles.get(id); if (!p) return null;
    const u = p.transitionTo(status); this._profiles.set(id, u);
    if (status === 'validated') await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_VALIDATED, subjectType: 'profile', subjectId: id });
    if (status === 'approved')  await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_APPROVED, subjectType: 'profile', subjectId: id });
    return u.toJSON();
  }

  // ─── EnrollmentProfile ────────────────────────────────────────────────────
  async createEnrollmentProfile(data) {
    const e = EnrollmentProfile.create(data);
    this._enrollments.set(e.id, e);
    await this.appendAudit({ type: AUDIT_EVENTS.ENROLLMENT_CREATED, subjectType: 'enrollment', subjectId: e.id });
    return e.toJSON();
  }
  async getEnrollmentProfile(id) { const e = this._enrollments.get(id); return e ? e.toJSON() : null; }
  async listEnrollmentProfiles({ limit = 50, offset = 0 } = {}) { return page([...this._enrollments.values()].sort(newestFirst), limit, offset); }
  async transitionEnrollmentProfile(id, status) {
    const e = this._enrollments.get(id); if (!e) return null;
    const u = e.transitionTo(status); this._enrollments.set(id, u);
    if (status === 'revoked') await this.appendAudit({ type: AUDIT_EVENTS.ENROLLMENT_REVOKED, subjectType: 'enrollment', subjectId: id });
    return u.toJSON();
  }

  // ─── EnrollmentToken (nur Hash, P_AGENT_1) ────────────────────────────────
  async createEnrollmentToken(domain) {
    this._tokens.set(domain.id, domain);
    this._tokenByHash.set(domain.tokenHash, domain.id);
    return domain.toJSON(); // ohne tokenHash
  }
  async findEnrollmentTokenByHash(hash) {
    const id = this._tokenByHash.get(hash);
    const t = id ? this._tokens.get(id) : null;
    return t ? t.toJSON() : null; // ohne tokenHash
  }
  async revokeEnrollmentToken(id) {
    const t = this._tokens.get(id); if (!t) return null;
    if (t.revoked) return null; // Compare-and-Set: bereits verbraucht/widerrufen → kein zweiter Gewinner
    const u = new EnrollmentToken({ id: t.id, enrollmentProfileId: t.enrollmentProfileId, tokenHash: t.tokenHash, prefix: t.prefix, expiresAt: t.expiresAt, revoked: true, createdAt: t.createdAt });
    this._tokens.set(id, u);
    return u.toJSON();
  }

  // ─── NodeCredential (nur Hash, P_INSTALL_1 Slice 2) ───────────────────────
  async createNodeCredential(domain) {
    this._credentials.set(domain.id, domain);
    this._credByHash.set(domain.tokenHash, domain.id);
    return domain.toJSON(); // ohne tokenHash
  }
  async findNodeCredentialByHash(hash) {
    const id = this._credByHash.get(hash);
    const c = id ? this._credentials.get(id) : null;
    return c ? c.toJSON() : null; // ohne tokenHash
  }
  async revokeNodeCredential(id, reason = null) {
    const c = this._credentials.get(id); if (!c) return null;
    // Compare-and-Set: nur ein aktives Credential wird widerrufen. Ein zweiter
    // (idempotenter) Aufruf findet status!=='active' und liefert null → der
    // Service auditiert dann NICHT erneut (kein Doppel-Audit, kein Reset von revokedAt).
    if (c.status !== 'active') return null;
    const u = new NodeCredential({ ...c, status: 'revoked', revokedAt: new Date().toISOString(), revokedReason: reason });
    this._credentials.set(id, u);
    return u.toJSON();
  }
  async touchNodeCredential(id) {
    const c = this._credentials.get(id); if (!c) return null;
    const u = new NodeCredential({ ...c, lastUsedAt: new Date().toISOString() });
    this._credentials.set(id, u);
    return u.toJSON();
  }
  // Alle Credentials einer Node — NUR sichere Felder (toJSON ohne tokenHash/Klartext).
  async listNodeCredentials(nodeId) {
    return [...this._credentials.values()]
      .filter((c) => c.nodeId === nodeId)
      .map((c) => c.toJSON())
      .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)); // neueste zuerst
  }

  // ─── InstalledNode ────────────────────────────────────────────────────────
  async findNodeByName(name) {
    for (const n of this._nodes.values()) if (n.name === name) return n.toJSON();
    return null;
  }
  async findNodesByIp(ip) {
    // ALLE Records für diese IP (newest-first). Der Aufrufer entscheidet die Policy —
    // ADR-042-Containment weist Mehrdeutigkeit fail-closed ab (E_AMBIGUOUS_NODE), statt
    // still einen zu wählen (DHCP → sonst evtl. falscher Host isoliert).
    if (!ip) return [];
    return [...this._nodes.values()].filter((n) => n.ip === ip).sort(newestFirst).map((n) => n.toJSON());
  }
  async createNode(data) {
    const n = InstalledNode.create(data);
    this._nodes.set(n.id, n);
    await this.appendAudit({ type: AUDIT_EVENTS.NODE_INSTALLED, subjectType: 'node', subjectId: n.id });
    return n.toJSON();
  }
  async getNode(id) { const n = this._nodes.get(id); return n ? n.toJSON() : null; }
  async listNodes({ limit = 50, offset = 0 } = {}) { return page([...this._nodes.values()].sort(newestFirst), limit, offset); }
  async updateNode(id, patch) { const n = this._nodes.get(id); if (!n) return null; const u = n.update(patch); this._nodes.set(id, u); return u.toJSON(); }
  async transitionNode(id, status) {
    const n = this._nodes.get(id); if (!n) return null;
    const u = n.transitionTo(status); this._nodes.set(id, u);
    if (status === 'enrolled') await this.appendAudit({ type: AUDIT_EVENTS.NODE_ENROLLED, subjectType: 'node', subjectId: id });
    if (status === 'retired')  await this.appendAudit({ type: AUDIT_EVENTS.NODE_RETIRED, subjectType: 'node', subjectId: id });
    return u.toJSON();
  }

  // ─── NodeCapability (read-only Reports) ───────────────────────────────────
  async reportCapability(data) {
    const c = NodeCapability.create(data);
    this._capabilities.push(c);
    await this.appendAudit({ type: AUDIT_EVENTS.CAPABILITY_REPORTED, subjectType: 'node', subjectId: c.nodeId, data: { capability: c.name } });
    return c.toJSON();
  }
  async listCapabilities(nodeId) { return this._capabilities.filter((c) => c.nodeId === nodeId).map((c) => c.toJSON()); }

  // ─── NodeHeartbeat (Beobachtung) ──────────────────────────────────────────
  async recordHeartbeat(data) {
    const h = NodeHeartbeat.create(data);
    this._heartbeats.push(h);
    await this.appendAudit({ type: AUDIT_EVENTS.HEARTBEAT_RECEIVED, subjectType: 'node', subjectId: h.nodeId, data: { status: h.status } });
    return h.toJSON();
  }
  async listHeartbeats(nodeId) { return this._heartbeats.filter((h) => h.nodeId === nodeId).map((h) => h.toJSON()); }
  async latestHeartbeat(nodeId) {
    const hs = this._heartbeats.filter((h) => h.nodeId === nodeId);
    return hs.length ? hs[hs.length - 1].toJSON() : null;
  }
}

module.exports = { InMemoryProvisioningRepository };
