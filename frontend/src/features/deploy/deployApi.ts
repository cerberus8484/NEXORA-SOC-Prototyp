// deployApi — Deployment Center (ADR-041). Admin-only Endpunkte unter /deploy.
// Infra-schreibender Kanal: Connector/Spec anlegen, Plan (Dry-Run), Approve
// (Vier-Augen), Apply (mit frischer Reauth via X-Reauth-Token). Der Server gated
// zusätzlich über DEPLOY_ENABLED — die UI ist NIE die alleinige Sicherheitsgrenze.

import { api } from '../../lib/apiClient';

// ── Enums (spiegeln das Backend-Domain-Model) ───────────────────────────────

export type DeployRunStatus =
  | 'planned' | 'approved' | 'applying' | 'cloning' | 'starting'
  | 'configuring' | 'verifying' | 'deployed' | 'rolling_back' | 'rolled_back' | 'failed_safe_stop';

// ── Domain-Typen ─────────────────────────────────────────────────────────────

export type DeployKind = 'vm-clone' | 'lxc-create' | 'agent-install';

export interface DeployModule {
  id: string;
  name: string;
  type: string;
  vendor: string;
  version: string;
  kind?: DeployKind;
  // vm-clone (Proxmox-Golden-Template) — bei agent-install nicht gesetzt.
  templateRefField?: string;
  configApplierId?: string;
  resourceDefaults?: { cpu: number; ramMB: number; diskGB: number };
  // agent-install (Software auf bestehendem Host) — bei vm-clone nicht gesetzt.
  controlAdapter?: string;
  targetKind?: string;
  paramSchema: Record<string, unknown>;
}

// Öffentliche Connector-Sicht — enthält NIE Token/Key/Secret (Backend redacted).
// hostKeyPin (SHA-256-Fingerprint) ist öffentlich und darf sichtbar sein.
export interface DeployConnector {
  id: string;
  type: string;               // 'proxmox' | 'ssh'
  name: string;
  host: string;
  // proxmox-only
  prefix?: string;
  targetNode?: string;
  storage?: string | null;
  bridge?: string | null;
  verifyTls?: boolean;
  // ssh-only
  sshUser?: string;
  sshPort?: number;
  hostKeyPin?: string;
  status: string;
  createdAt: string;
}

// Read-only Inventar eines Deploy-Ziels. Der Server liefert keine Zugangsdaten,
// sondern ausschließlich die Daten, die für eine sichere Platzierungsentscheidung
// im Assistant nötig sind.
export interface ProxmoxConnectorCapacity {
  kind: 'proxmox';
  updatedAt: string;
  node: {
    name: string;
    online: boolean;
    cpu: { used: number; total: number };
    memory: { usedBytes: number; totalBytes: number };
  };
  storage: { name: string | null; usedBytes: number; totalBytes: number; freeBytes: number };
  guests: { vms: number; containers: number };
  templates: {
    vm: Array<{ vmid: number; name: string }>;
    lxc: Array<{ volid: string; name: string }>;
  };
}
export interface ProxmoxCertificateInfo { fingerprint: string; validTo: string }

export interface DeploySpec {
  id: string;
  moduleId: string;
  connectorId: string;
  targetNode: string;
  storage: string;
  bridge: string;
  resources: { cpu?: number; ramMB?: number; diskGB?: number };
  params: Record<string, unknown>;
  specHash: string;
  createdAt: string;
}

export interface DeployRun {
  id: string;
  specId: string;
  status: DeployRunStatus;
  vmid: number | null;
  startedBy: string;
  startedById: string | null;
  approvedBy: string | null;
  approvedById: string | null;
  startedAt: string;
  approvedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
}

export interface Preconditions {
  ok: boolean;
  issues: string[];
  // vm-clone
  templateExists?: boolean;
  bridgeExists?: boolean;
  vmidFree?: boolean;
  // agent-install (reiner Dry-Run, kein Ziel-Kontakt)
  kind?: DeployKind;
  controlAdapter?: string;
  targetHost?: string;
  wazuhManager?: string;
  agentName?: string;
}

export interface PlanResult { run: DeployRun; preconditions: Preconditions }

// Zwei-Schlüssel-Systemstatus des Deploy-Gates (Preflight-Panel).
export interface DeployPreflightCheck { id: string; label: string; ok: boolean; hint?: string }
export interface DeployPreflight {
  effectiveEnabled: boolean;
  state: 'not_commissioned' | 'disarmed' | 'armed';
  canArm: boolean;
  blockers: string[];
  checks: DeployPreflightCheck[];
}
export interface RunDetail { run: DeployRun; steps: DeployRunStep[] }

// Maskierte Sicht auf das Platform-Deploy-Keypair (Slice 6d) — NIE der Private-Key.
// isSet=false ⇒ noch nicht generiert. publicKey/fingerprint sind öffentlich.
export interface DeployKeypairInfo {
  isSet: boolean;
  publicKey?: string | null;
  fingerprint?: string | null;
  createdAt?: string | null;
}

// Ergebnis eines Node-Updates (Slice 4/6f) — der Service liefert nur sichere Felder.
export interface NodeUpdateResult { ok: true; nodeId: string; host: string }

// Ergebnis einer Host-Key-Erfassung (Option 2) — Fingerprint zum Out-of-Band-Abgleich.
export interface HostKeyCaptureResult { nodeId: string; host: string; fingerprint: string }

export interface DeployRunStep {
  id: string;
  runId: string;
  step: string;
  status: string;
  detail: unknown;
  at: string;
}

// ── Request-Bodies ───────────────────────────────────────────────────────────

export interface CreateProxmoxConnectorBody {
  type: 'proxmox';
  name: string;
  host: string;
  apiToken: string;
  targetNode: string;
  storage?: string;
  bridge?: string;
  verifyTls?: boolean;
}

// SSH-Connector (agent-install): privateKey ist write-only, wird server-seitig
// verschlüsselt; hostKeyPin = SHA-256-Hex des erwarteten Server-Host-Keys.
export interface CreateSshConnectorBody {
  type: 'ssh';
  name: string;
  host: string;
  sshUser?: string;
  sshPort?: number;
  privateKey: string;
  passphrase?: string;
  hostKeyPin: string;
}

export type CreateConnectorBody = CreateProxmoxConnectorBody | CreateSshConnectorBody;

export interface CreateSpecBody {
  moduleId: string;
  connectorId: string;
  // Placement nur für vm-clone; agent-install (Brownfield) lässt es weg.
  targetNode?: string;
  storage?: string;
  bridge?: string;
  resources?: { cpu: number; ramMB: number; diskGB: number };
  params: Record<string, unknown>;
}

// ── API-Hüllen ───────────────────────────────────────────────────────────────

interface ListResponse<T> { data: T[]; requestId?: string }
interface ItemResponse<T> { data: T; requestId?: string }

// ── Client ───────────────────────────────────────────────────────────────────

export const deployApi = {
  /** GET /deploy/modules — Katalog der deploybaren System-Module. */
  listModules: (opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<DeployModule>>('/deploy/modules', undefined, opts),

  /** GET /deploy/connectors — angelegte Hypervisor-Connectoren (ohne Token). */
  listConnectors: (opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<DeployConnector>>('/deploy/connectors', undefined, opts),

  /** GET /deploy/connectors/:id/capacity — read-only Proxmox-Kapazität/Template-Inventar. */
  getConnectorCapacity: (connectorId: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<ProxmoxConnectorCapacity>>(`/deploy/connectors/${connectorId}/capacity`, undefined, opts),
  inspectConnectorCertificate: (connectorId: string) => api.get<ItemResponse<ProxmoxCertificateInfo>>(`/deploy/connectors/${connectorId}/certificate`),
  trustConnectorCertificate: (connectorId: string, fingerprint: string, reauthToken: string) => api.post<ItemResponse<DeployConnector>>(`/deploy/connectors/${connectorId}/certificate/trust`, { fingerprint }, { headers: { 'X-Reauth-Token': reauthToken } }),

  /**
   * POST /deploy/connectors — Connector anlegen (Secret wird server-seitig verschlüsselt).
   * Braucht frische Reauth (X-Reauth-Token) wie Apply — ein Connector speichert ein
   * Geheimnis (SSH-Key/API-Token), daher Passwort-Step-up.
   */
  createConnector: (body: CreateConnectorBody, reauthToken: string) =>
    api.post<ItemResponse<DeployConnector>>('/deploy/connectors', body, { headers: { 'X-Reauth-Token': reauthToken } }),

  /** POST /deploy/specs — Deploy-Spec anlegen (validiert + idempotent). */
  createSpec: (body: CreateSpecBody) =>
    api.post<ItemResponse<DeploySpec>>('/deploy/specs', body),

  /** POST /deploy/specs/:id/plan — Dry-Run (kein Infra-Write) → planned Run. */
  plan: (specId: string) =>
    api.post<ItemResponse<PlanResult>>(`/deploy/specs/${specId}/plan`, {}),

  /** POST /deploy/runs/:runId/approve — Vier-Augen-Genehmigung. */
  approve: (runId: string, note?: string) =>
    api.post<ItemResponse<DeployRun>>(`/deploy/runs/${runId}/approve`, { note }),

  /**
   * POST /deploy/runs/:runId/apply — Infra-Write. Braucht frische Reauth
   * (X-Reauth-Token) UND scharfes DEPLOY_ENABLED am Server. Liefert den End-Run
   * (die Schritte holt die UI separat über getRun).
   */
  apply: (runId: string, reauthToken: string) =>
    api.post<ItemResponse<DeployRun>>(`/deploy/runs/${runId}/apply`, {}, { headers: { 'X-Reauth-Token': reauthToken } }),

  /** GET /deploy/runs/:runId — Run-Detail inkl. Schritte. */
  getRun: (runId: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<RunDetail>>(`/deploy/runs/${runId}`, undefined, opts),

  /** GET /deploy/runs — jüngste Runs für die Dashboard-Übersicht. */
  listRuns: (opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<DeployRun>>('/deploy/runs', undefined, opts),

  /** GET /deploy/preflight — Zwei-Schlüssel-Systemstatus (armed/inert + Boot-Checks). */
  getPreflight: (opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<DeployPreflight>>('/deploy/preflight', undefined, opts),

  /** POST /deploy/arm — betrieblich scharfschalten (admin + Reauth). Nur bei erfülltem Boden. */
  arm: (reauthToken: string) =>
    api.post<ItemResponse<DeployPreflight>>('/deploy/arm', {}, { headers: { 'X-Reauth-Token': reauthToken } }),

  /** POST /deploy/disarm — entwaffnen (sichere Richtung, immer erlaubt). */
  disarm: (reauthToken: string) =>
    api.post<ItemResponse<DeployPreflight>>('/deploy/disarm', {}, { headers: { 'X-Reauth-Token': reauthToken } }),

  /** POST /auth/deploy-reauth — frischer deploy_reauth-Token (Passwort-Bestätigung). */
  reauth: (password: string) =>
    api.post<{ data: { reauthToken: string; expiresIn: number }; requestId?: string }>('/auth/deploy-reauth', { password }),

  // ── Node-Update / Host-Key / Keypair (Slice 6/7, „updatebar") ───────────────

  /** GET /deploy/keypair — maskierte Sicht auf das Platform-Deploy-Keypair (nie Private-Key). */
  getKeypair: (opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<DeployKeypairInfo>>('/deploy/keypair', undefined, opts),

  /**
   * POST /deploy/keypair/generate — Keypair generieren/rotieren. Braucht frische Reauth.
   * ACHTUNG: Rotieren invalidiert bestehende authorized_keys-Provisionierungen —
   * bereits ausgerollte Server sind danach nicht mehr per SSH erreichbar (neu ausrollen).
   */
  generateKeypair: (reauthToken: string) =>
    api.post<ItemResponse<DeployKeypairInfo>>('/deploy/keypair/generate', {}, { headers: { 'X-Reauth-Token': reauthToken } }),

  /**
   * POST /deploy/nodes/:id/update — gated Node-Update (Wazuh-Agent). Braucht frische
   * Reauth UND scharfes NODE_UPDATE_ENABLED am Server. Host + Kanal kommen aus der
   * Registry/dem Deploy-Keypair — NIE aus dem Request. agentVersion optional (Ziel-Version).
   */
  updateNode: (nodeId: string, reauthToken: string, agentVersion?: string) =>
    api.post<ItemResponse<NodeUpdateResult>>(
      `/deploy/nodes/${nodeId}/update`,
      agentVersion ? { agentVersion } : {},
      { headers: { 'X-Reauth-Token': reauthToken } },
    ),

  /**
   * POST /deploy/nodes/:id/hostkey/capture — Host-Key des Nodes scannen + pinnen
   * (Option 2, Prep für Updates). Braucht frische Reauth; Host aus der Registry.
   * Liefert den Fingerprint zum Out-of-Band-Abgleich durch den Admin.
   */
  captureHostKey: (nodeId: string, reauthToken: string) =>
    api.post<ItemResponse<HostKeyCaptureResult>>(
      `/deploy/nodes/${nodeId}/hostkey/capture`,
      {},
      { headers: { 'X-Reauth-Token': reauthToken } },
    ),
};
