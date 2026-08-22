import { api } from '../../lib/apiClient';

export interface RagStatusResponse {
  enabled: boolean;
  qdrantReachable: boolean;
  collectionExists?: boolean;
  collection: string;
  vectorCount: number | null;
  requestId?: string;
}

export interface RagReindexResponse {
  message: string;
  requestId?: string;
}

export const ragApi = {
  /** GET /rag/status — fail-safe, antwortet immer (auch wenn RAG_ENABLED=false). */
  status: (opts?: { signal?: AbortSignal }) =>
    api.get<RagStatusResponse>('/rag/status', undefined, opts),

  /** POST /rag/reindex — admin only, fire-and-forget (202). Wirft ApiError 409 wenn RAG_ENABLED=false. */
  reindex: (opts?: { signal?: AbortSignal }) =>
    api.post<RagReindexResponse>('/rag/reindex', undefined, opts),
};
