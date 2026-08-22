import { api } from '../../lib/apiClient';
import type {
  HuntSession, HuntCommand, HuntArtifact, HuntFinding, HuntTicketLink, HuntLog, HuntResponseAction, ListEnvelope,
  FindingVerdict, HuntResponseCircuit,
} from '../../lib/types';

export interface CreateHuntBody {
  targetHost: string;
  huntType?: string;
  title?: string;
  riskLevel?: string;
  targetType?: string;
  sourceIp?: string;
  destinationIp?: string;
  scope?: string;
  hypothesis?: string;
  ticketId?: string;
}

export interface HuntCatalogItem {
  key: string;
  label: string;
  description: string;
  category: string;
  mitre: string;
  dataSources: string[];
  targetType: string;
  defaultTarget: string;
  defaultIp: string;
  riskLevel: string;
}

// Eine Hunt-Notiz (append-only, zeitgestempelt) — Vertrag mit dem Backend hunt_notes.
export interface HuntNote {
  id: string;
  sessionId?: string;
  content: string;
  analystId?: string;
  createdAt: string;
}

export const huntApi = {
  catalog: () => api.get<ListEnvelope<HuntCatalogItem>>('/hunts/catalog'),
  listSessions: () => api.get<ListEnvelope<HuntSession>>('/hunts'),
  getSession: (id: string) => api.get<{ data: HuntSession }>(`/hunts/${id}`),
  createSession: (body: CreateHuntBody) =>
    api.post<{ data: HuntSession }>('/hunts', body),

  start:    (id: string) => api.post<{ data: HuntSession }>(`/hunts/${id}/start`),
  pause:    (id: string) => api.post<{ data: unknown }>(`/hunts/${id}/pause`),
  // ADMIN-ONLY (Backend: requireRole('admin')). Einen Cancel-Button NICHT an `canAct`
  // (analyst+) hängen — sonst 403. Nur hinter einem Admin-Gate verdrahten. Siehe hunts.js RBAC.
  cancel:   (id: string) => api.post<{ data: HuntSession }>(`/hunts/${id}/cancel`),
  complete: (id: string) => api.post<{ data: HuntSession }>(`/hunts/${id}/complete`),

  logs:     (id: string) => api.get<ListEnvelope<HuntLog>>(`/hunts/${id}/logs`),
  runCommand: (id: string, command: string) =>
    api.post<{ data: HuntCommand }>(`/hunts/${id}/run-command`, { command }),

  responseActions: (id: string) => api.get<ListEnvelope<HuntResponseAction>>(`/hunts/${id}/response-actions`),
  requestAction: (id: string, body: { kind: string; command?: string; reason?: string }) =>
    api.post<{ data: HuntResponseAction }>(`/hunts/${id}/response-actions`, body),
  approveAction: (id: string, actionId: string, authorizationBasis: string) =>
    api.post<{ data: HuntResponseAction }>(`/hunts/${id}/response-actions/${actionId}/approve`, { authorizationBasis }),
  rejectAction: (id: string, actionId: string, reason: string) =>
    api.post<{ data: HuntResponseAction }>(`/hunts/${id}/response-actions/${actionId}/reject`, { reason }),
  // ADR-042 Stufe 3: echte, menschlich ausgelöste Ausführung. Admin-only + frische Reauth
  // (X-Reauth-Token). Server-seitig mehrfach gated (Kill-Switch, Reauth, Drei-Parteien);
  // inert bis HUNT_RESPONSE_REAL_EXEC_ENABLED + konfigurierter Kanal.
  executeAction: (id: string, actionId: string, reauthToken: string) =>
    api.post<{ data: HuntResponseAction }>(`/hunts/${id}/response-actions/${actionId}/execute`, {}, { headers: { 'X-Reauth-Token': reauthToken } }),
  // ADR-042 Circuit-Breaker: globaler Containment-Kanal-Zustand + Admin-Reset.
  responseCircuit: () => api.get<{ data: HuntResponseCircuit }>('/hunts/response-circuit'),
  resetResponseCircuit: () => api.post<{ data: { open: boolean; wasOpen: boolean } }>('/hunts/response-circuit/reset', {}),

  commands:  (id: string) => api.get<ListEnvelope<HuntCommand>>(`/hunts/${id}/commands`),
  artifacts: (id: string) => api.get<ListEnvelope<HuntArtifact>>(`/hunts/${id}/artifacts`),
  findings:  (id: string) => api.get<ListEnvelope<HuntFinding>>(`/hunts/${id}/findings`),
  ticketLinks: (id: string) => api.get<ListEnvelope<HuntTicketLink>>(`/hunts/${id}/ticket-links`),

  addCommand: (id: string, body: { type: string; command: string; description?: string }) =>
    api.post<{ data: HuntCommand }>(`/hunts/${id}/commands`, body),

  addFinding: (id: string, body: { title: string; severity: string; description?: string; mitreAttack?: string; recommendation?: string }) =>
    api.post<{ data: HuntFinding }>(`/hunts/${id}/findings`, body),

  addArtifact: (id: string, body: { type: string; value: string; description?: string }) =>
    api.post<{ data: HuntArtifact }>(`/hunts/${id}/artifacts`, body),

  // P_TRUST_1 · A3: Notizen sind append-only HuntNote[] (Backend), nicht ein String.
  getNotes: (id: string) => api.get<{ data: HuntNote[] }>(`/hunts/${id}/notes`),
  saveNotes: (id: string, content: string) =>
    api.post<{ data: HuntNote }>(`/hunts/${id}/notes`, { content }),

  createTicket: (id: string, findingId: string) =>
    api.post<{ data: { status: string; ticketId?: string } }>(`/hunts/${id}/findings/${findingId}/create-ticket`),
  addEvidence: (id: string, findingId: string) =>
    api.post<{ data: { status: string; evidenceId?: string; ticketId?: string } }>(`/hunts/${id}/findings/${findingId}/add-evidence`),

  /** Analyst-Verdict an einem Finding setzen (Block B2). */
  setFindingVerdict: (sessionId: string, findingId: string, verdict: FindingVerdict) =>
    api.post<{ data: HuntFinding }>(`/hunts/${sessionId}/findings/${findingId}/verdict`, { verdict }),
};
