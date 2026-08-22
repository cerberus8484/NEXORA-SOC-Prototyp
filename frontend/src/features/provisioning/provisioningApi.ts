// provisioningApi — Registry-Sicht auf das Provisioning-Backend (P_ADMIN_1).
// Admin-only Endpunkte unter /v1/provisioning. Rein lesend + Profil anlegen +
// Token minten. KEINE Apply-/Command-/Remote-Aufrufe — die gibt es im Backend nicht.

import { api } from '../../lib/apiClient';

// ── Enums (spiegeln das Backend-Domain-Model) ───────────────────────────────

export type NodeStatus = 'pending' | 'enrolled' | 'active' | 'stale' | 'retired';
export type HeartbeatStatus = 'healthy' | 'degraded' | 'offline';
export type EnrollmentStatus = 'active' | 'expired' | 'revoked';
export type NodeCredentialStatus = 'active' | 'revoked';

export type NodeRole =
  | 'control_plane'
  | 'normal_agent'
  | 'integration_connector'
  | 'network_sensor'
  | 'gateway_sensor';

export type Capability =
  | 'inventory'
  | 'log_collection'
  | 'syslog_receiver'
  | 'flow_collector'
  | 'sniffing'
  | 'command_safe'
  | 'heartbeat'
  | 'version_report'
  | 'update_status';

// ── Domain-Typen ─────────────────────────────────────────────────────────────

export interface InstalledNode {
  id: string;
  name: string;
  role: NodeRole;
  profileId: string | null;
  fqdn: string | null;
  ip: string | null;
  os: string | null;
  version: string | null;
  status: NodeStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Gepinnter Host-Key (SHA-256-Hex) für Updates via ssh-powershell (Slice 6a).
  // Öffentlich (kein Secret); null, solange nicht erfasst. Steuert die Update-UI.
  hostKeyPin: string | null;
}

export interface EnrollmentProfile {
  id: string;
  name: string;
  role: NodeRole;
  capabilities: Capability[];
  expiresAt: string | null;
  status: EnrollmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NodeCapabilityReport {
  id: string;
  nodeId: string;
  name: Capability;
  detail: unknown;
  reportedAt: string;
}

export interface NodeHeartbeat {
  id: string;
  nodeId: string;
  status: HeartbeatStatus;
  agentVersion: string | null;
  note: string | null;
  receivedAt: string;
}

// Credential-Lifecycle-Sicht — enthält NIE den Hash/Klartext (Backend redacted via toJSON).
export interface NodeCredentialSummary {
  id: string;
  nodeId: string;
  prefix: string;
  status: NodeCredentialStatus;
  issuedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface RetireResult {
  nodeId: string;
  revokedCredentials: number;
}

// Token-Antwort enthält NIE den Hash — Klartext nur einmalig beim Mint.
export interface EnrollmentTokenInfo {
  id: string;
  enrollmentProfileId: string;
  prefix: string;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface ProvisioningAuditEvent {
  id: string;
  type: string;
  actor: string | null;
  subjectType: string;
  subjectId: string | null;
  data: Record<string, unknown>;
  at: string;
}

export interface NodeDetail {
  node: InstalledNode;
  capabilities: NodeCapabilityReport[];
  heartbeats: NodeHeartbeat[];
  latestHeartbeat: NodeHeartbeat | null;
}

// ── Request-Bodies ───────────────────────────────────────────────────────────

export interface CreateEnrollmentProfileBody {
  name: string;
  role: NodeRole;
  capabilities?: Capability[];
  expiresAt?: string | null;
}

export interface MintTokenBody {
  ttlSeconds?: number;
}

// ── API-Hüllen ───────────────────────────────────────────────────────────────

interface ListResponse<T> { data: T[]; total: number; requestId?: string }
interface ItemResponse<T> { data: T; requestId?: string }
interface MintResponse { data: { token: string; enrollmentToken: EnrollmentTokenInfo }; requestId?: string }

export interface ListParams { limit?: number; offset?: number }
export interface AuditParams { type?: string; subjectId?: string; limit?: number; offset?: number }

// ── Allowed-Listen (für Formulare; Quelle der Wahrheit ist das Backend) ──────

export const NODE_ROLES: NodeRole[] = [
  'control_plane', 'normal_agent', 'integration_connector', 'network_sensor', 'gateway_sensor',
];

export const CAPABILITIES: Capability[] = [
  'inventory', 'log_collection', 'syslog_receiver', 'flow_collector',
  'sniffing', 'command_safe', 'heartbeat', 'version_report', 'update_status',
];

// ── Client ───────────────────────────────────────────────────────────────────

export const provisioningApi = {
  /** GET /provisioning/nodes — Node-Registry (paginiert). */
  listNodes: (params?: ListParams, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<InstalledNode>>('/provisioning/nodes', params as Record<string, number> | undefined, opts),

  /** GET /provisioning/nodes/:id — Node-Detail inkl. Capabilities + Heartbeats. */
  getNode: (id: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<NodeDetail>>(`/provisioning/nodes/${id}`, undefined, opts),

  /** GET /provisioning/enrollment-profiles — Enrollment-Profile. */
  listEnrollmentProfiles: (opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<EnrollmentProfile>>('/provisioning/enrollment-profiles', undefined, opts),

  /** POST /provisioning/enrollment-profiles — neues Profil anlegen. */
  createEnrollmentProfile: (body: CreateEnrollmentProfileBody) =>
    api.post<ItemResponse<EnrollmentProfile>>('/provisioning/enrollment-profiles', body),

  /** POST /provisioning/enrollment-profiles/:id/token — Token minten (Klartext EINMALIG). */
  mintToken: (profileId: string, body: MintTokenBody = {}) =>
    api.post<MintResponse>(`/provisioning/enrollment-profiles/${profileId}/token`, body),

  /** GET /provisioning/audit — Provisioning-Audit (gefiltert). */
  listAudit: (params?: AuditParams, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<ProvisioningAuditEvent>>('/provisioning/audit', params as Record<string, string | number> | undefined, opts),

  // ── Credential-Lifecycle (P_PROVISION_SECURITY_1, admin) ────────────────────

  /** GET /provisioning/nodes/:id/credentials — Credential-Status (NIE Hash/Klartext). */
  listNodeCredentials: (nodeId: string, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<NodeCredentialSummary>>(`/provisioning/nodes/${nodeId}/credentials`, undefined, opts),

  /** POST /provisioning/nodes/:id/credentials/:credId/revoke — Credential widerrufen. */
  revokeCredential: (nodeId: string, credentialId: string, reason?: string) =>
    api.post<ItemResponse<NodeCredentialSummary>>(`/provisioning/nodes/${nodeId}/credentials/${credentialId}/revoke`, { reason }),

  /** POST /provisioning/nodes/:id/retire — Node stilllegen (widerruft aktive Credentials). */
  retireNode: (nodeId: string, reason?: string) =>
    api.post<ItemResponse<RetireResult>>(`/provisioning/nodes/${nodeId}/retire`, { reason }),
};
