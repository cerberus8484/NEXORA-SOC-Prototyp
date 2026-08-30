import { api } from '../../lib/apiClient';

export interface UseCaseItem {
  id: string;
  value: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/** Client für die geteilte Use-Case-Bibliothek (`/v1/use-cases`). */
export const useCaseApi = {
  list: () => api.get<{ data: UseCaseItem[]; total: number }>('/use-cases'),
  create: (value: string) => api.post<{ data: UseCaseItem }>('/use-cases', { value }),
  remove: (id: string) => api.del<void>(`/use-cases/${id}`),
};
