import { api } from '../../lib/apiClient';

export interface EvidenceItem {
  id: string;
  ticketId: string;
  type: string;
  source: string;
  title: string;
  filename?: string;
  logSource: string;
  eventId: string;
  query: string;
  rawText: string;
  eventTimestamp: string | null;
  confidence: number | null;
  comment: string;
  collectedBy: string;
  collectedAt: string;
  createdAt: string;
  sha256: string;
  reviewStatus?: 'open' | 'reviewed' | 'verified' | 'flagged';
}

export interface CustodyEvent {
  id: string;
  evidenceId: string;
  action: 'viewed' | 'reviewed' | 'verified' | 'flagged' | 'note';
  actor: string;
  note: string;
  createdAt: string;
}

export type EvidenceDetail = EvidenceItem & {
  custody: CustodyEvent[];
  reviewStatus: 'open' | 'reviewed' | 'verified' | 'flagged';
};

export const evidenceApi = {
  /** Evidence-Items eines Tickets (Chain of Custody). */
  list: (ticketId: string) => api.get<{ data: EvidenceItem[] }>('/evidence', { ticketId }),
  /** Letzte N Evidence-Items global (Evidence Center). */
  recent: (limit = 200) => api.get<{ data: EvidenceItem[] }>('/evidence', { limit }),
  /** Evidence-Item + Chain-of-Custody-Log + Review-Status. */
  get: (id: string) => api.get<{ data: EvidenceDetail }>(`/evidence/${id}`),
  /** Custody-Event protokollieren (reviewed/verified/flagged). */
  custody: (id: string, action: CustodyEvent['action'], note = '') =>
    api.post<{ data: EvidenceDetail }>(`/evidence/${id}/custody`, { action, note }),
  /** Evidence-Paket eines Tickets erzeugen (inkl. Integritätsprüfung) für Handover/Export.
   *  A4b: bewusste Aktion → POST (protokolliert Custody + Audit), kein GET. */
  exportTicket: (ticketId: string) => api.post<{ data: { ticketId: string; exportedAt: string; count: number; integrityOk: boolean; items: EvidenceItem[] } }>('/evidence/export', { ticketId }),
  /** Neues Evidence-Item anlegen (append-only). `content` nur bei type=file_upload. */
  add: (body: Partial<EvidenceItem> & { ticketId: string; title: string; content?: string }) =>
    api.post<{ data: EvidenceItem }>('/evidence', body),
};
