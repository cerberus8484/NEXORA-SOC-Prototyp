import { api } from '../../lib/apiClient';

export interface AuditEntry {
  id: string;
  action: string;
  actorLabel: string;
  targetType: string;
  targetId: string;
  ip: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface AuditListParams {
  limit?: number;
  offset?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  /** A6a: serverseitige Volltext-Suche über Actor/Action/Target. */
  search?: string;
}

export interface AuditListResponse {
  data: AuditEntry[];
  /** Gesamtanzahl aller Einträge (mit gleicher WHERE-Klausel, ohne Limit). */
  total?: number;
  /** Angewendetes Limit (gespiegelt vom Backend). */
  limit?: number;
  /** Angewendeter Offset (gespiegelt vom Backend). */
  offset?: number;
  /** A6a: explizite Pagination-Metadaten. */
  page?: number;
  pageSize?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  requestId?: string;
}

export interface AuditExportParams {
  action?: string;
  targetType?: string;
  targetId?: string;
  search?: string;
  format: 'csv' | 'pdf';
}

export interface AuditExportResponse {
  data: AuditEntry[];
  total?: number;
  returned?: number;
  /** A6c: true, wenn die Gesamtmenge den Export-Cap überschreitet (sichtbar machen!). */
  truncated?: boolean;
  exportLimit?: number;
  requestId?: string;
}

export const auditApi = {
  list: (params?: AuditListParams, opts?: { signal?: AbortSignal }) =>
    api.get<AuditListResponse>('/audit', params as Record<string, string | number | undefined>, opts),

  /** A6c: bewusster, serverseitig auditierter Export (gedeckelt). POST → schreibt Audit-Eintrag. */
  exportAudit: (params: AuditExportParams) =>
    api.post<AuditExportResponse>('/audit/export', params),

  /** Neueste N Audit-Einträge — für das Dashboard-Aktivitäts-Widget. */
  recent: (limit = 25, opts?: { signal?: AbortSignal }) =>
    api.get<AuditListResponse>('/audit', { limit }, opts),
};
