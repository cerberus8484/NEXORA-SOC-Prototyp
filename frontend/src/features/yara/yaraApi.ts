import { api } from '../../lib/apiClient';

export interface YaraPattern {
  id: string;
  type: 'text' | 'hex' | 'regex';
  value: string;
  modifiers: string[];
}

export interface YaraRule {
  id: string;
  name: string;
  description: string;
  tags: string[];
  patterns: YaraPattern[];
  condition: string | { threshold: number };
  enabled: boolean;
  author: string;
  severity: string;
  mitreAttack: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScanMatch {
  ruleId: string;
  name: string;
  severity: string;
  mitreAttack: string;
  hits: { patternId: string; value: string }[];
}

export const yaraApi = {
  list: (params?: { enabledOnly?: boolean; tag?: string }) => {
    const q: Record<string, string | number | null | undefined> = {};
    if (params?.enabledOnly !== undefined) q['enabledOnly'] = params.enabledOnly ? '1' : '0';
    if (params?.tag) q['tag'] = params.tag;
    return api.get<{ data: YaraRule[]; total: number }>('/yara', q);
  },

  get: (id: string) =>
    api.get<{ data: YaraRule }>(`/yara/${id}`),

  create: (body: Partial<YaraRule>) =>
    api.post<{ data: YaraRule }>('/yara', body),

  update: (id: string, body: Partial<YaraRule>) =>
    api.put<{ data: YaraRule }>(`/yara/${id}`, body),

  delete: (id: string) =>
    api.del<void>(`/yara/${id}`),

  scan: (input: string, tag?: string) =>
    api.post<{ data: { matches: ScanMatch[]; scannedRules: number } }>('/yara/scan', { input, tag }),
};
