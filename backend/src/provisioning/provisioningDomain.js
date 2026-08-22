'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_PROVISION_1 — Provisioning Domain-Model (rein, kein Live-Pfad)
//
// Modelliert den geplanten Soll-Zustand von Nodes/Agents/Provisioning, BEVOR
// Enrollment, Heartbeats oder Apply-Mechaniken entstehen. **Nur Zustand +
// Validierung — kein Apply, kein Netzwerk, kein Remote-Call, kein Installer.**
//
// Stil wie der Rest des Backends: Domain-Klasse mit static create() (validiert,
// setzt id/Timestamps), immutabler update()/transitionTo() (neue Instanz),
// toJSON(). Validierungsfehler werfen mit { status: 400 }.
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID, randomBytes, createHash } = require('crypto');
const { KNOWN_ROLES } = require('./validateNodeProfile');

// ─── Enums / Lifecycle ────────────────────────────────────────────────────
const PROFILE_STATUS     = ['draft', 'validated', 'approved', 'retired'];
const ENROLLMENT_STATUS  = ['active', 'expired', 'revoked'];
const NODE_STATUS        = ['pending', 'enrolled', 'active', 'stale', 'retired'];
const HEARTBEAT_STATUS   = ['healthy', 'degraded', 'offline'];

const PROFILE_TRANSITIONS    = { draft: ['validated', 'retired'], validated: ['approved', 'draft', 'retired'], approved: ['retired'], retired: [] };
const ENROLLMENT_TRANSITIONS = { active: ['expired', 'revoked'], expired: [], revoked: [] };
const NODE_TRANSITIONS       = { pending: ['enrolled', 'retired'], enrolled: ['active', 'retired'], active: ['stale', 'retired'], stale: ['active', 'retired'], retired: [] };

// Erlaubte, read-only Capabilities (keine ausführbare Netz-/Firewall-Aktion).
const CAPABILITIES = ['inventory', 'log_collection', 'syslog_receiver', 'flow_collector', 'sniffing', 'command_safe', 'heartbeat', 'version_report', 'update_status'];

// Zentrale Audit-Event-Namen (append-only; keine Secrets in data).
const AUDIT_EVENTS = {
  PROFILE_CREATED:     'provisioning.profile.created',
  PROFILE_VALIDATED:   'provisioning.profile.validated',
  PROFILE_APPROVED:    'provisioning.profile.approved',
  ENROLLMENT_CREATED:  'enrollment.profile.created',
  ENROLLMENT_REVOKED:  'enrollment.profile.revoked',
  ENROLLMENT_TOKEN_ISSUED:  'enrollment.token.issued',
  ENROLLMENT_TOKEN_REVOKED: 'enrollment.token.revoked',
  ENROLLMENT_TOKEN_CONSUMED: 'enrollment.token.consumed',
  NODE_CREDENTIAL_ISSUED:   'node.credential.issued',
  NODE_CREDENTIAL_REVOKED:  'node.credential.revoked',
  NODE_INSTALLED:      'node.installed',
  NODE_ENROLLED:       'node.enrolled',
  NODE_RETIRED:        'node.retired',
  HEARTBEAT_RECEIVED:  'node.heartbeat.received',
  CAPABILITY_REPORTED: 'node.capability.reported',
  PLAN_GENERATED:      'provisioning.plan.generated',
  APPLY_BLOCKED:       'provisioning.apply.blocked',
};
const AUDIT_EVENT_NAMES = Object.values(AUDIT_EVENTS);

// ─── Shared Helpers ────────────────────────────────────────────────────────
const SECRET_KEY = /(password|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer|credential)/i;

function err(message, status = 400) { return Object.assign(new Error(message), { status }); }
function isObj(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw err(`${field} fehlt oder ist leer`);
}
function assertRole(role) {
  if (!KNOWN_ROLES.includes(role)) throw err(`role unbekannt: '${role}' (erlaubt: ${KNOWN_ROLES.join(', ')})`);
}
// SSH-Host-Key-Pin: SHA-256 als 64-stelliger Hex-String (oder null/leer = nicht erfasst).
function assertHostKeyPin(value) {
  if (value == null || value === '') return null;
  const s = String(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) throw err('host_key_pin muss ein SHA-256-Hex (64 Zeichen) sein');
  return s;
}
function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw err(`${field} ungültig: '${value}' (erlaubt: ${allowed.join(', ')})`);
}
// Rekursiv prüfen, dass keine Secret-Schlüssel im Objekt stehen (keine Klartext-Tokens).
function assertNoSecrets(value, path = '') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`)); return; }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) throw err(`Secret im Klartext nicht erlaubt: '${path ? `${path}.` : ''}${k}' (Tokens/Secrets kommen aus dem Backend, nicht ins Modell)`);
    assertNoSecrets(v, path ? `${path}.${k}` : k);
  }
}
function cleanLabels(labels) {
  if (labels === undefined || labels === null) return {};
  if (!isObj(labels)) throw err('labels muss ein Objekt sein');
  assertNoSecrets(labels, 'labels');
  const out = {};
  for (const [k, v] of Object.entries(labels)) out[String(k)] = String(v);
  return out;
}
// Status-Übergang prüfen: gleich = no-op; sonst muss er erlaubt sein.
function guardTransition(map, from, to) {
  assertEnum(to, Object.keys(map), 'status');
  if (from === to) return;
  if (!(map[from] || []).includes(to)) throw err(`ungültige transition: ${from} → ${to}`);
}

// ─── ProvisioningProfile (gewünschter Soll-Zustand) ─────────────────────────
class ProvisioningProfile {
  constructor({ id = randomUUID(), name, role, labels = {}, status = 'draft', createdBy = '', createdAt, updatedAt } = {}) {
    this.id = id; this.name = name; this.role = role; this.labels = labels;
    this.status = status; this.createdBy = String(createdBy || '');
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || this.createdAt;
  }
  static create(data = {}) {
    assertNonEmpty(data.name, 'name'); assertRole(data.role);
    const now = new Date().toISOString();
    return new ProvisioningProfile({ id: randomUUID(), name: String(data.name), role: data.role, labels: cleanLabels(data.labels), status: 'draft', createdBy: data.createdBy, createdAt: now, updatedAt: now });
  }
  update(patch = {}) {
    const next = { ...this.toJSON() };
    if (patch.name !== undefined) { assertNonEmpty(patch.name, 'name'); next.name = String(patch.name); }
    if (patch.labels !== undefined) next.labels = cleanLabels(patch.labels);
    if (patch.createdBy !== undefined) next.createdBy = String(patch.createdBy);
    next.updatedAt = new Date().toISOString();
    return new ProvisioningProfile(next);
  }
  transitionTo(status) {
    guardTransition(PROFILE_TRANSITIONS, this.status, status);
    return new ProvisioningProfile({ ...this.toJSON(), status, updatedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, name: this.name, role: this.role, labels: this.labels, status: this.status, createdBy: this.createdBy, createdAt: this.createdAt, updatedAt: this.updatedAt }; }
}

// ─── EnrollmentProfile (Vorlage; speichert KEIN Token) ──────────────────────
class EnrollmentProfile {
  constructor({ id = randomUUID(), name, role, capabilities = [], expiresAt = null, status = 'active', createdAt, updatedAt } = {}) {
    this.id = id; this.name = name; this.role = role; this.capabilities = capabilities;
    this.expiresAt = expiresAt; this.status = status;
    this.createdAt = createdAt || new Date().toISOString(); this.updatedAt = updatedAt || this.createdAt;
  }
  static create(data = {}) {
    assertNonEmpty(data.name, 'name'); assertRole(data.role);
    assertNoSecrets(data); // token/secret im Input → Fehler
    const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
    caps.forEach((c) => assertEnum(c, CAPABILITIES, 'capability'));
    const now = new Date().toISOString();
    return new EnrollmentProfile({ id: randomUUID(), name: String(data.name), role: data.role, capabilities: [...caps], expiresAt: data.expiresAt || null, status: 'active', createdAt: now, updatedAt: now });
  }
  transitionTo(status) {
    guardTransition(ENROLLMENT_TRANSITIONS, this.status, status);
    return new EnrollmentProfile({ ...this.toJSON(), status, updatedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, name: this.name, role: this.role, capabilities: this.capabilities, expiresAt: this.expiresAt, status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt }; }
}

// ─── EnrollmentToken (Bootstrap-Credential; speichert NUR den Hash) ──────────
// Sicherheits-Invarianten (wie ApiToken):
//   - Klartext-Token wird mit mint() EINMALIG zurückgegeben, danach nie wieder
//     rekonstruierbar — gespeichert wird ausschließlich der SHA-256-Hash.
//   - toJSON() gibt NIEMALS tokenHash oder Klartext aus.
//   - Der Token ist NUR ein Bootstrap-Credential für Enrollment/Heartbeat —
//     er trägt KEINE Apply-/Remote-/Netz-Berechtigung.
const ENROLL_TOKEN_PREFIX = 'enr_';
const ENROLL_TOKEN_DEFAULT_TTL = 86400; // 24 h

class EnrollmentToken {
  constructor({ id = randomUUID(), enrollmentProfileId, tokenHash, prefix = '', expiresAt = null, revoked = false, createdAt } = {}) {
    this.id = id; this.enrollmentProfileId = enrollmentProfileId;
    this.tokenHash = tokenHash; this.prefix = prefix;
    this.expiresAt = expiresAt; this.revoked = revoked;
    this.createdAt = createdAt || new Date().toISOString();
  }
  // Erzeugt Klartext-Token (EINMALIG) + Domain (nur Hash). Klartext danach weg.
  static mint({ enrollmentProfileId, ttlSeconds = ENROLL_TOKEN_DEFAULT_TTL } = {}) {
    assertNonEmpty(enrollmentProfileId, 'enrollmentProfileId');
    const ttl = Number(ttlSeconds);
    if (!Number.isFinite(ttl) || ttl <= 0) throw err('ttlSeconds muss eine Zahl > 0 sein');
    const token = ENROLL_TOKEN_PREFIX + randomBytes(32).toString('hex'); // enr_ + 64 hex
    const now = new Date();
    const domain = new EnrollmentToken({
      id: randomUUID(),
      enrollmentProfileId: String(enrollmentProfileId),
      tokenHash: EnrollmentToken.hash(token),
      prefix: token.slice(0, 12) + '...',
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      revoked: false,
      createdAt: now.toISOString(),
    });
    return { token, domain };
  }
  static hash(rawToken) { return createHash('sha256').update(String(rawToken)).digest('hex'); }
  get isExpired() { return this.expiresAt ? new Date(this.expiresAt) < new Date() : false; }
  get isActive() { return !this.revoked && !this.isExpired; }
  toJSON() { return { id: this.id, enrollmentProfileId: this.enrollmentProfileId, prefix: this.prefix, expiresAt: this.expiresAt, revoked: this.revoked, createdAt: this.createdAt }; }
}

// ─── NodeCredential (Betriebs-Credential für Heartbeats; speichert NUR Hash) ─
// Trennung Bootstrap vs. Betrieb: der Enrollment-Token ist EINMALIG (Bootstrap),
// das NodeCredential ist das langlebige, an die Node gebundene Betriebs-Credential.
// Invarianten wie EnrollmentToken: Klartext genau einmal (mint), Storage nur als
// SHA-256-Hash, toJSON nie Hash/Klartext. Trägt KEINE Apply-/Remote-Berechtigung.
const NODE_CRED_PREFIX = 'ncr_';
const CREDENTIAL_STATUS = ['active', 'revoked'];

class NodeCredential {
  constructor({ id = randomUUID(), nodeId, tokenHash, prefix = '', status = 'active', issuedAt, lastUsedAt = null, revokedAt = null, revokedReason = null } = {}) {
    this.id = id; this.nodeId = nodeId; this.tokenHash = tokenHash; this.prefix = prefix;
    this.status = status;
    this.issuedAt = issuedAt || new Date().toISOString();
    this.lastUsedAt = lastUsedAt; this.revokedAt = revokedAt; this.revokedReason = revokedReason;
  }
  // Erzeugt Klartext-Credential (EINMALIG) + Domain (nur Hash).
  static mint({ nodeId } = {}) {
    assertNonEmpty(nodeId, 'nodeId');
    const credential = NODE_CRED_PREFIX + randomBytes(32).toString('hex'); // ncr_ + 64 hex (256-bit)
    return {
      credential,
      domain: new NodeCredential({
        id: randomUUID(), nodeId: String(nodeId),
        tokenHash: NodeCredential.hash(credential),
        prefix: credential.slice(0, 12) + '...',
        status: 'active', issuedAt: new Date().toISOString(),
      }),
    };
  }
  static hash(raw) { return createHash('sha256').update(String(raw)).digest('hex'); }
  get isActive() { return this.status === 'active'; }
  toJSON() { return { id: this.id, nodeId: this.nodeId, prefix: this.prefix, status: this.status, issuedAt: this.issuedAt, lastUsedAt: this.lastUsedAt, revokedAt: this.revokedAt, revokedReason: this.revokedReason }; }
}

// ─── InstalledNode ──────────────────────────────────────────────────────────
class InstalledNode {
  constructor({ id = randomUUID(), name, role, profileId = null, fqdn = null, ip = null, os = null, version = null, status = 'pending', lastSeenAt = null, hostKeyPin = null, sshUser = null, createdAt, updatedAt } = {}) {
    this.id = id; this.name = name; this.role = role; this.profileId = profileId;
    this.fqdn = fqdn; this.ip = ip; this.os = os; this.version = version;
    this.status = status; this.lastSeenAt = lastSeenAt; this.hostKeyPin = hostKeyPin;
    this.sshUser = sshUser;
    this.createdAt = createdAt || new Date().toISOString(); this.updatedAt = updatedAt || this.createdAt;
  }
  static create(data = {}) {
    assertNonEmpty(data.name, 'name'); assertRole(data.role); assertNoSecrets(data);
    const now = new Date().toISOString();
    return new InstalledNode({ id: randomUUID(), name: String(data.name), role: data.role, profileId: data.profileId || null, fqdn: data.fqdn || null, ip: data.ip || null, os: data.os || null, version: data.version || null, hostKeyPin: assertHostKeyPin(data.hostKeyPin), sshUser: data.sshUser || null, status: 'pending', createdAt: now, updatedAt: now });
  }
  update(patch = {}) {
    const next = { ...this.toJSON() };
    for (const k of ['fqdn', 'ip', 'os', 'version', 'profileId', 'lastSeenAt', 'hostKeyPin', 'sshUser']) if (patch[k] !== undefined) next[k] = patch[k];
    next.hostKeyPin = assertHostKeyPin(next.hostKeyPin); // validiert/normalisiert (SHA-256-Hex oder null)
    assertNoSecrets(next);
    next.updatedAt = new Date().toISOString();
    return new InstalledNode(next);
  }
  transitionTo(status) {
    guardTransition(NODE_TRANSITIONS, this.status, status);
    return new InstalledNode({ ...this.toJSON(), status, updatedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, name: this.name, role: this.role, profileId: this.profileId, fqdn: this.fqdn, ip: this.ip, os: this.os, version: this.version, status: this.status, lastSeenAt: this.lastSeenAt, hostKeyPin: this.hostKeyPin, sshUser: this.sshUser, createdAt: this.createdAt, updatedAt: this.updatedAt }; }
}

// ─── NodeCapability (read-only Report) ──────────────────────────────────────
class NodeCapability {
  constructor({ id = randomUUID(), nodeId, name, detail = null, reportedAt } = {}) {
    this.id = id; this.nodeId = nodeId; this.name = name; this.detail = detail;
    this.reportedAt = reportedAt || new Date().toISOString();
  }
  static create(data = {}) {
    assertNonEmpty(data.nodeId, 'nodeId'); assertEnum(data.name, CAPABILITIES, 'capability');
    if (data.detail !== undefined && data.detail !== null) assertNoSecrets({ detail: data.detail });
    return new NodeCapability({ id: randomUUID(), nodeId: String(data.nodeId), name: data.name, detail: data.detail ?? null, reportedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, nodeId: this.nodeId, name: this.name, detail: this.detail, reportedAt: this.reportedAt }; }
}

// ─── NodeHeartbeat (Beobachtung; Health-Status) ─────────────────────────────
class NodeHeartbeat {
  constructor({ id = randomUUID(), nodeId, status, agentVersion = null, note = null, receivedAt } = {}) {
    this.id = id; this.nodeId = nodeId; this.status = status; this.agentVersion = agentVersion; this.note = note;
    this.receivedAt = receivedAt || new Date().toISOString();
  }
  static create(data = {}) {
    assertNonEmpty(data.nodeId, 'nodeId'); assertEnum(data.status, HEARTBEAT_STATUS, 'status');
    return new NodeHeartbeat({ id: randomUUID(), nodeId: String(data.nodeId), status: data.status, agentVersion: data.agentVersion || null, note: data.note || null, receivedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, nodeId: this.nodeId, status: this.status, agentVersion: this.agentVersion, note: this.note, receivedAt: this.receivedAt }; }
}

// ─── ProvisioningAuditEvent (append-only, redacted) ─────────────────────────
class ProvisioningAuditEvent {
  constructor({ id = randomUUID(), type, actor = null, subjectType, subjectId = null, data = {}, at } = {}) {
    this.id = id; this.type = type; this.actor = actor; this.subjectType = subjectType; this.subjectId = subjectId;
    this.data = data; this.at = at || new Date().toISOString();
    // bewusst KEINE update()/delete()-Methode — Audit ist append-only.
  }
  static create(input = {}) {
    assertEnum(input.type, AUDIT_EVENT_NAMES, 'type');
    assertNonEmpty(input.subjectType, 'subjectType');
    const data = input.data ?? {};
    assertNoSecrets(data, 'data'); // keine Tokens/Secrets loggen
    return new ProvisioningAuditEvent({ id: randomUUID(), type: input.type, actor: input.actor || null, subjectType: String(input.subjectType), subjectId: input.subjectId || null, data, at: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, type: this.type, actor: this.actor, subjectType: this.subjectType, subjectId: this.subjectId, data: this.data, at: this.at }; }
}

module.exports = {
  ProvisioningProfile, EnrollmentProfile, EnrollmentToken, NodeCredential, InstalledNode, NodeCapability, NodeHeartbeat, ProvisioningAuditEvent,
  PROFILE_STATUS, ENROLLMENT_STATUS, NODE_STATUS, HEARTBEAT_STATUS, CREDENTIAL_STATUS,
  PROFILE_TRANSITIONS, ENROLLMENT_TRANSITIONS, NODE_TRANSITIONS,
  CAPABILITIES, AUDIT_EVENTS, AUDIT_EVENT_NAMES,
  ENROLL_TOKEN_PREFIX, ENROLL_TOKEN_DEFAULT_TTL, NODE_CRED_PREFIX,
};
