'use strict';

// ─────────────────────────────────────────────────────────────────────────
// PostgresProvisioningRepository (P_PROVISION_2)
//
// Postgres-Implementierung des Provisioning-Repository (DB_ENABLED=true).
// Gleicher öffentlicher Vertrag wie InMemoryProvisioningRepository.
// Migration 033_provisioning.sql muss vorab laufen.
//
// REIN Zustand: keine Apply-/Netzwerk-/Remote-Methode. Audit ist append-only
// (DB-seitig per Trigger erzwungen). Keine Klartext-Secrets (Domain redacted).
// ─────────────────────────────────────────────────────────────────────────

const { pool } = require('../db/pool');
const {
  ProvisioningProfile, EnrollmentProfile, InstalledNode,
  NodeCapability, NodeHeartbeat, ProvisioningAuditEvent, AUDIT_EVENTS,
} = require('../provisioning/provisioningDomain');

class PostgresProvisioningRepository {
  // ─── Mapping-Helfer (snake_case → camelCase, jsonb) ───────────────────────
  _iso(v) { return v == null ? null : (v instanceof Date ? v.toISOString() : String(v)); }
  _json(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
    return v;
  }
  _toProfile(r) { return r && { id: r.id, name: r.name, role: r.role, labels: this._json(r.labels, {}), status: r.status, createdBy: r.created_by, createdAt: this._iso(r.created_at), updatedAt: this._iso(r.updated_at) }; }
  _toEnrollment(r) { return r && { id: r.id, name: r.name, role: r.role, capabilities: this._json(r.capabilities, []), expiresAt: this._iso(r.expires_at), status: r.status, createdAt: this._iso(r.created_at), updatedAt: this._iso(r.updated_at) }; }
  _toNode(r) { return r && { id: r.id, name: r.name, role: r.role, profileId: r.profile_id ?? null, fqdn: r.fqdn ?? null, ip: r.ip ?? null, os: r.os ?? null, version: r.version ?? null, status: r.status, lastSeenAt: this._iso(r.last_seen_at), hostKeyPin: r.host_key_pin ?? null, sshUser: r.ssh_user ?? null, createdAt: this._iso(r.created_at), updatedAt: this._iso(r.updated_at) }; }
  _toCapability(r) { return r && { id: r.id, nodeId: r.node_id, name: r.name, detail: this._json(r.detail, null), reportedAt: this._iso(r.reported_at) }; }
  _toHeartbeat(r) { return r && { id: r.id, nodeId: r.node_id, status: r.status, agentVersion: r.agent_version ?? null, note: r.note ?? null, receivedAt: this._iso(r.received_at) }; }
  _toAudit(r) { return r && { id: r.id, type: r.type, actor: r.actor ?? null, subjectType: r.subject_type, subjectId: r.subject_id ?? null, data: this._json(r.data, {}), at: this._iso(r.at) }; }
  // EnrollmentToken: NIE token_hash nach außen geben (Redaction).
  _toEnrollmentToken(r) { return r && { id: r.id, enrollmentProfileId: r.enrollment_profile_id, prefix: r.prefix, expiresAt: this._iso(r.expires_at), revoked: r.revoked, createdAt: this._iso(r.created_at) }; }
  // NodeCredential: NIE token_hash nach außen geben (Redaction).
  _toNodeCredential(r) { return r && { id: r.id, nodeId: r.node_id, prefix: r.prefix, status: r.status, issuedAt: this._iso(r.issued_at), lastUsedAt: this._iso(r.last_used_at), revokedAt: this._iso(r.revoked_at), revokedReason: r.revoked_reason ?? null }; }

  // ─── Audit (append-only) ──────────────────────────────────────────────────
  async appendAudit(input) {
    const ev = ProvisioningAuditEvent.create(input); // validiert + redacted
    const { rows } = await pool.query(
      `INSERT INTO provisioning_audit_events (id, type, actor, subject_type, subject_id, data, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ev.id, ev.type, ev.actor, ev.subjectType, ev.subjectId, JSON.stringify(ev.data), ev.at]);
    return this._toAudit(rows[0]);
  }
  async listAudit({ type, subjectId, limit = 100, offset = 0 } = {}) {
    const where = []; const params = []; let p = 1;
    if (type)      { where.push(`type = $${p++}`); params.push(type); }
    if (subjectId) { where.push(`subject_id = $${p++}`); params.push(subjectId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [data, count] = await Promise.all([
      pool.query(`SELECT * FROM provisioning_audit_events ${clause} ORDER BY at DESC LIMIT $${p++} OFFSET $${p++}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM provisioning_audit_events ${clause}`, params),
    ]);
    return { data: data.rows.map((r) => this._toAudit(r)), total: Number(count.rows[0].count) };
  }

  // ─── ProvisioningProfile ──────────────────────────────────────────────────
  async createProfile(data) {
    const e = ProvisioningProfile.create(data);
    const { rows } = await pool.query(
      `INSERT INTO provisioning_profiles (id, name, role, labels, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [e.id, e.name, e.role, JSON.stringify(e.labels), e.status, e.createdBy, e.createdAt, e.updatedAt]);
    await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_CREATED, subjectType: 'profile', subjectId: e.id, actor: data.createdBy || null });
    return this._toProfile(rows[0]);
  }
  async getProfile(id) { const { rows } = await pool.query('SELECT * FROM provisioning_profiles WHERE id = $1', [id]); return rows[0] ? this._toProfile(rows[0]) : null; }
  async listProfiles({ limit = 50, offset = 0 } = {}) {
    const [d, c] = await Promise.all([
      pool.query('SELECT * FROM provisioning_profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM provisioning_profiles'),
    ]);
    return { data: d.rows.map((r) => this._toProfile(r)), total: Number(c.rows[0].count) };
  }
  async updateProfile(id, patch) {
    const existing = await this.getProfile(id); if (!existing) return null;
    const u = new ProvisioningProfile(existing).update(patch);
    const { rows } = await pool.query(
      'UPDATE provisioning_profiles SET name=$1, labels=$2, created_by=$3, updated_at=$4 WHERE id=$5 RETURNING *',
      [u.name, JSON.stringify(u.labels), u.createdBy, u.updatedAt, id]);
    return rows[0] ? this._toProfile(rows[0]) : null;
  }
  async transitionProfile(id, status) {
    const existing = await this.getProfile(id); if (!existing) return null;
    const u = new ProvisioningProfile(existing).transitionTo(status);
    const { rows } = await pool.query('UPDATE provisioning_profiles SET status=$1, updated_at=$2 WHERE id=$3 RETURNING *', [u.status, u.updatedAt, id]);
    if (status === 'validated') await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_VALIDATED, subjectType: 'profile', subjectId: id });
    if (status === 'approved')  await this.appendAudit({ type: AUDIT_EVENTS.PROFILE_APPROVED, subjectType: 'profile', subjectId: id });
    return rows[0] ? this._toProfile(rows[0]) : null;
  }

  // ─── EnrollmentProfile ────────────────────────────────────────────────────
  async createEnrollmentProfile(data) {
    const e = EnrollmentProfile.create(data);
    const { rows } = await pool.query(
      `INSERT INTO enrollment_profiles (id, name, role, capabilities, expires_at, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [e.id, e.name, e.role, JSON.stringify(e.capabilities), e.expiresAt, e.status, e.createdAt, e.updatedAt]);
    await this.appendAudit({ type: AUDIT_EVENTS.ENROLLMENT_CREATED, subjectType: 'enrollment', subjectId: e.id });
    return this._toEnrollment(rows[0]);
  }
  async getEnrollmentProfile(id) { const { rows } = await pool.query('SELECT * FROM enrollment_profiles WHERE id = $1', [id]); return rows[0] ? this._toEnrollment(rows[0]) : null; }
  async listEnrollmentProfiles({ limit = 50, offset = 0 } = {}) {
    const [d, c] = await Promise.all([
      pool.query('SELECT * FROM enrollment_profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM enrollment_profiles'),
    ]);
    return { data: d.rows.map((r) => this._toEnrollment(r)), total: Number(c.rows[0].count) };
  }
  async transitionEnrollmentProfile(id, status) {
    const existing = await this.getEnrollmentProfile(id); if (!existing) return null;
    const u = new EnrollmentProfile(existing).transitionTo(status);
    const { rows } = await pool.query('UPDATE enrollment_profiles SET status=$1, updated_at=$2 WHERE id=$3 RETURNING *', [u.status, u.updatedAt, id]);
    if (status === 'revoked') await this.appendAudit({ type: AUDIT_EVENTS.ENROLLMENT_REVOKED, subjectType: 'enrollment', subjectId: id });
    return rows[0] ? this._toEnrollment(rows[0]) : null;
  }

  // ─── InstalledNode ────────────────────────────────────────────────────────
  async createNode(data) {
    const e = InstalledNode.create(data);
    const { rows } = await pool.query(
      `INSERT INTO installed_nodes (id, name, role, profile_id, fqdn, ip, os, version, status, last_seen_at, host_key_pin, ssh_user, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [e.id, e.name, e.role, e.profileId, e.fqdn, e.ip, e.os, e.version, e.status, e.lastSeenAt, e.hostKeyPin, e.sshUser, e.createdAt, e.updatedAt]);
    await this.appendAudit({ type: AUDIT_EVENTS.NODE_INSTALLED, subjectType: 'node', subjectId: e.id });
    return this._toNode(rows[0]);
  }
  async getNode(id) { const { rows } = await pool.query('SELECT * FROM installed_nodes WHERE id = $1', [id]); return rows[0] ? this._toNode(rows[0]) : null; }
  async listNodes({ limit = 50, offset = 0 } = {}) {
    const [d, c] = await Promise.all([
      pool.query('SELECT * FROM installed_nodes ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM installed_nodes'),
    ]);
    return { data: d.rows.map((r) => this._toNode(r)), total: Number(c.rows[0].count) };
  }
  async updateNode(id, patch) {
    const existing = await this.getNode(id); if (!existing) return null;
    const u = new InstalledNode(existing).update(patch);
    const { rows } = await pool.query(
      'UPDATE installed_nodes SET profile_id=$1, fqdn=$2, ip=$3, os=$4, version=$5, last_seen_at=$6, host_key_pin=$7, ssh_user=$8, updated_at=$9 WHERE id=$10 RETURNING *',
      [u.profileId, u.fqdn, u.ip, u.os, u.version, u.lastSeenAt, u.hostKeyPin, u.sshUser, u.updatedAt, id]);
    return rows[0] ? this._toNode(rows[0]) : null;
  }
  async transitionNode(id, status) {
    const existing = await this.getNode(id); if (!existing) return null;
    const u = new InstalledNode(existing).transitionTo(status);
    const { rows } = await pool.query('UPDATE installed_nodes SET status=$1, updated_at=$2 WHERE id=$3 RETURNING *', [u.status, u.updatedAt, id]);
    if (status === 'enrolled') await this.appendAudit({ type: AUDIT_EVENTS.NODE_ENROLLED, subjectType: 'node', subjectId: id });
    if (status === 'retired')  await this.appendAudit({ type: AUDIT_EVENTS.NODE_RETIRED, subjectType: 'node', subjectId: id });
    return rows[0] ? this._toNode(rows[0]) : null;
  }

  // ─── NodeCapability ───────────────────────────────────────────────────────
  async reportCapability(data) {
    const e = NodeCapability.create(data);
    const { rows } = await pool.query(
      'INSERT INTO node_capabilities (id, node_id, name, detail, reported_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [e.id, e.nodeId, e.name, e.detail == null ? null : JSON.stringify(e.detail), e.reportedAt]);
    await this.appendAudit({ type: AUDIT_EVENTS.CAPABILITY_REPORTED, subjectType: 'node', subjectId: e.nodeId, data: { capability: e.name } });
    return this._toCapability(rows[0]);
  }
  async listCapabilities(nodeId) {
    const { rows } = await pool.query('SELECT * FROM node_capabilities WHERE node_id = $1 ORDER BY reported_at ASC', [nodeId]);
    return rows.map((r) => this._toCapability(r));
  }

  // ─── NodeHeartbeat ────────────────────────────────────────────────────────
  async recordHeartbeat(data) {
    const e = NodeHeartbeat.create(data);
    const { rows } = await pool.query(
      'INSERT INTO node_heartbeats (id, node_id, status, agent_version, note, received_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [e.id, e.nodeId, e.status, e.agentVersion, e.note, e.receivedAt]);
    await this.appendAudit({ type: AUDIT_EVENTS.HEARTBEAT_RECEIVED, subjectType: 'node', subjectId: e.nodeId, data: { status: e.status } });
    return this._toHeartbeat(rows[0]);
  }
  async listHeartbeats(nodeId) {
    const { rows } = await pool.query('SELECT * FROM node_heartbeats WHERE node_id = $1 ORDER BY received_at ASC', [nodeId]);
    return rows.map((r) => this._toHeartbeat(r));
  }
  async latestHeartbeat(nodeId) {
    const { rows } = await pool.query('SELECT * FROM node_heartbeats WHERE node_id = $1 ORDER BY received_at DESC LIMIT 1', [nodeId]);
    return rows[0] ? this._toHeartbeat(rows[0]) : null;
  }

  // ─── EnrollmentToken (nur Hash, P_AGENT_1) ────────────────────────────────
  async createEnrollmentToken(domain) {
    const { rows } = await pool.query(
      `INSERT INTO enrollment_tokens (id, enrollment_profile_id, token_hash, prefix, expires_at, revoked, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [domain.id, domain.enrollmentProfileId, domain.tokenHash, domain.prefix, domain.expiresAt, domain.revoked, domain.createdAt]);
    return this._toEnrollmentToken(rows[0]); // ohne token_hash
  }
  async findEnrollmentTokenByHash(hash) {
    const { rows } = await pool.query('SELECT * FROM enrollment_tokens WHERE token_hash = $1', [hash]);
    return rows[0] ? this._toEnrollmentToken(rows[0]) : null;
  }
  async revokeEnrollmentToken(id) {
    // Atomarer Compare-and-Set: nur ein paralleler Aufruf gewinnt (revoked=false → true).
    // Verhindert, dass zwei gleichzeitige Enrollments denselben Token verbrauchen.
    const { rows } = await pool.query('UPDATE enrollment_tokens SET revoked = true WHERE id = $1 AND revoked = false RETURNING *', [id]);
    return rows[0] ? this._toEnrollmentToken(rows[0]) : null;
  }

  async findNodeByName(name) {
    const { rows } = await pool.query('SELECT * FROM installed_nodes WHERE name = $1 ORDER BY created_at DESC LIMIT 1', [name]);
    return rows[0] ? this._toNode(rows[0]) : null;
  }

  async findNodesByIp(ip) {
    // ALLE Records für diese IP (newest-first) — Ambiguitäts-Policy liegt beim Aufrufer
    // (ADR-042: fail-closed bei > 1, kein stilles Picken in DHCP-Umgebungen).
    if (!ip) return [];
    const { rows } = await pool.query('SELECT * FROM installed_nodes WHERE ip = $1 ORDER BY created_at DESC', [ip]);
    return rows.map((r) => this._toNode(r));
  }

  // ─── NodeCredential (nur Hash, P_INSTALL_1 Slice 2) ───────────────────────
  async createNodeCredential(domain) {
    const { rows } = await pool.query(
      `INSERT INTO node_credentials (id, node_id, token_hash, prefix, status, issued_at, last_used_at, revoked_at, revoked_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [domain.id, domain.nodeId, domain.tokenHash, domain.prefix, domain.status, domain.issuedAt, domain.lastUsedAt, domain.revokedAt, domain.revokedReason]);
    return this._toNodeCredential(rows[0]); // ohne token_hash
  }
  async findNodeCredentialByHash(hash) {
    const { rows } = await pool.query('SELECT * FROM node_credentials WHERE token_hash = $1', [hash]);
    return rows[0] ? this._toNodeCredential(rows[0]) : null;
  }
  async revokeNodeCredential(id, reason = null) {
    // Atomarer Compare-and-Set: nur ein AKTIVES Credential wird widerrufen.
    // Idempotenter Zweitaufruf trifft kein active-Row → null → kein Doppel-Audit.
    const { rows } = await pool.query(
      "UPDATE node_credentials SET status='revoked', revoked_at=now(), revoked_reason=$2 WHERE id=$1 AND status='active' RETURNING *",
      [id, reason]);
    return rows[0] ? this._toNodeCredential(rows[0]) : null;
  }
  async touchNodeCredential(id) {
    const { rows } = await pool.query('UPDATE node_credentials SET last_used_at=now() WHERE id=$1 RETURNING *', [id]);
    return rows[0] ? this._toNodeCredential(rows[0]) : null;
  }
  // Alle Credentials einer Node — _toNodeCredential redacted den token_hash.
  async listNodeCredentials(nodeId) {
    const { rows } = await pool.query(
      'SELECT * FROM node_credentials WHERE node_id = $1 ORDER BY issued_at DESC', [nodeId]);
    return rows.map((r) => this._toNodeCredential(r));
  }
}

module.exports = { PostgresProvisioningRepository };
