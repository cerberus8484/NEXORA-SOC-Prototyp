import { api } from '../../lib/apiClient';
import type { AnalysisTemplate, TemplateFields } from './vorlagenModel';

/** CRUD-Client für die geteilte Analyse-Vorlagen-Bibliothek (`/v1/analysis-templates`). */
export const templateApi = {
  list: () => api.get<{ data: AnalysisTemplate[]; total: number }>('/analysis-templates'),
  create: (body: { name: string } & Partial<TemplateFields>) =>
    api.post<{ data: AnalysisTemplate }>('/analysis-templates', body),
  update: (id: string, body: Partial<TemplateFields & { name: string }>) =>
    api.put<{ data: AnalysisTemplate }>(`/analysis-templates/${id}`, body),
  remove: (id: string) => api.del<void>(`/analysis-templates/${id}`),
};
