import { api } from '../../lib/apiClient';
import type { Ticket, TicketListResponse } from '../../lib/types';
import type { ParsedEvidence, EvidenceApiResponse, FpScope, FpRuleTarget, FpPreviewResult, FpActionResult, WazuhFpException, TicketTimeline, NetworkCorrelation } from '../analysis/analysisModel';
import type { AuditEntry } from '../analysis/historyModel';
import type { BulkDeleteResult } from './bulkDeleteModel';

export const ticketApi = {
  list: (params?: { state?: string; status?: string; priority?: string; source?: string; analyst?: string; search?: string; limit?: number; sort?: string; order?: string }) =>
    api.get<TicketListResponse>('/tickets', params),
  // Nur IDs der gefilterten Tickets („alle auswählen") — höheres limit als die Liste (bis 5000).
  listIds: (params?: { state?: string; status?: string; priority?: string; source?: string; analyst?: string; search?: string; limit?: number; offset?: number; sort?: string; order?: string }) =>
    api.get<{ ids: string[]; total: number }>('/tickets/ids', params),
  get: (id: string) => api.get<{ data: Ticket }>(`/tickets/${id}`),
  create: (body: Partial<Ticket> & Record<string, unknown>) => api.post<{ data: Ticket }>('/tickets', body),
  update: (id: string, body: Partial<Ticket> & Record<string, unknown>) => api.put<{ data: Ticket }>(`/tickets/${id}`, body),
  /** Strukturierte Forensik-Evidence + async Korrelationsstatus (P_CORR_1c). */
  evidence: (id: string) => api.get<EvidenceApiResponse>(`/tickets/${id}/evidence`),
  /** Flow-/Event-Timeline aus dem Wazuh-Indexer (echte Block-/Alert-Events der Offense). */
  timeline: (id: string) => api.get<{ enabled: boolean; data: TicketTimeline | null; network?: NetworkCorrelation }>(`/tickets/${id}/timeline`),
  /** Ticket-Historie aus dem Audit-Log (wer hat wann was geändert). */
  history: (id: string) => api.get<{ data: AuditEntry[] }>(`/tickets/${id}/history`),
  /** Reputation der Ticket-IPs (Batch) über den Threat-Intel-Service. */
  enrichIocs: (id: string) => api.post<{ data: { indicatorValue: string; verdict: string; score: number; confidence: number; source: string; summary: string }[] }>(`/tickets/${id}/threat-intel/enrich`, {}),
  /** Cross-Reference: andere Tickets, die dieselben Indikatoren referenzieren. */
  crossRef: (values: string[], excludeId: string) =>
    api.post<{ data: Record<string, { id: string; ticketNr: string; title: string; priority: string; state: string }[]> }>('/tickets/cross-ref', { values, excludeId }),
  /** Vorbefüllter FP-Exception-Scope aus der Evidence (kein Write). */
  fpSuggest: (id: string) => api.get<{ data: FpScope | null; ruleTarget?: FpRuleTarget | null }>(`/tickets/${id}/fp-exception/suggest`),
  /** XML-Vorschau der scoped FP-Ausnahme (KEIN Wazuh-Write). */
  fpPreview: (id: string, scope: Partial<FpScope>) => api.post<FpPreviewResult>(`/tickets/${id}/fp-exception/preview`, scope),
  /** FP-Ausnahmen am Ticket + Capabilities (Safety-Gate). */
  fpList: (id: string) => api.get<{ data: WazuhFpException[]; capabilities: { applyEnabled: boolean; apiConfigured: boolean } }>(`/tickets/${id}/fp-exception`),
  /** Weiterleiten — Analyst erstellt + leitet zur Freigabe weiter (KEIN Write, analyst+). */
  fpForward: (id: string, scope: Partial<FpScope>) => api.post<FpActionResult>(`/tickets/${id}/fp-exception/forward`, scope),
  /** Apply — schreibt Rule-Datei + validiert, KEIN Restart (engineer/admin). */
  fpApply: (id: string, scope: Partial<FpScope>) => api.post<FpActionResult>(`/tickets/${id}/fp-exception/apply`, scope),
  /** Ein-Klick — rollenabhängig: Analyst→weiterleiten, Engineer/Admin→schreiben. Scope baut der Server aus der Evidence; reason ist Pflicht. */
  fpQuick: (id: string, scope: Partial<FpScope>) => api.post<FpActionResult>(`/tickets/${id}/fp-exception/quick`, scope),
  /** Expliziter Manager-Restart (admin). */
  fpRestart: (id: string, exceptionId: string) => api.post<FpActionResult>(`/tickets/${id}/fp-exception/restart`, { exceptionId }),
  /** Regel entfernen (admin). */
  fpRevert: (id: string, exceptionId: string) => api.post<FpActionResult>(`/tickets/${id}/fp-exception/revert`, { exceptionId }),
  /** Ticket löschen (admin only). Backend antwortet 204 No Content. */
  delete: (id: string) => api.del<void>(`/tickets/${id}`),
  /** Sammel-Löschung (admin only). EIN Request für mehrere IDs; ehrliches Ergebnis
   *  { requested, deleted, missing, deletedIds }. Backend cappt bei 100. */
  bulkDelete: (ids: string[]) => api.post<{ data: BulkDeleteResult }>(`/tickets/bulk-delete`, { ids }),
  /** P16: Endpoint-Artefakte (Prozesse/Ports/Netzwerk) für ein Ticket sammeln (analyst+). */
  collectEvidence: (id: string) =>
    api.post<CollectEvidenceResponse>(`/tickets/${id}/collect-evidence`, {}),
  /** Smart-Parser-Preview — parst raw-String (IP/Hash/URL/…) server-seitig, persistiert NICHT.
   *  Analyst entscheidet im Modal, ob er das Ergebnis als Evidence speichert. */
  importRaw: (ticketId: string, raw: string, sourceType: string) =>
    api.post<ImportRawResponse>(`/tickets/${ticketId}/import`, { raw, sourceType }),
};

/** Antwort von POST /tickets/:id/collect-evidence — ok-Flag + optionaler Grund/Anzahl. */
export interface CollectEvidenceResponse {
  ok: boolean;
  collected?: number;
  reason?: string;
  requestId?: string;
}

/** Antwort von POST /tickets/:id/import — geparste Evidence (Preview, kein Persistieren). */
export interface ImportRawResponse {
  data: {
    type: string;
    evidence: ParsedEvidence;
    iocs: { type: string; value: string }[];
  };
  requestId?: string;
}
