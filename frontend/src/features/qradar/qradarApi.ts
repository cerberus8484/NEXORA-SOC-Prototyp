import { api } from '../../lib/apiClient';

export type QRadarPriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface QRadarOffense {
  id: number;
  offenseName: string;
  description: string;
  status: 'OPEN' | 'CLOSED' | 'HIDDEN';
  priority: QRadarPriority;
  severity: number;
  credibility: number;
  relevance: number;
  magnitude: number;
  categories: string[];
  eventCount: number;
  flowCount: number;
  sourceCount: number;
  sourceIps: string[];
  destIps: string[];
  assignedTo: string | null;
  mitreT: string[];
  logSources: string[];
  startTime: string;
  lastUpdated: string;
}

export interface QRadarEvent {
  time: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  log_source: string;
  category: string;
  username: string | null;
  message: string;
}

export interface QRadarStats {
  openCount: number;
  criticalCount: number;
  highCount: number;
  totalEvents: number;
  bySeverity: Record<QRadarPriority, number>;
  topCategories: { name: string; count: number }[];
  /** false wenn QRADAR_BASE_URL / QRADAR_TOKEN nicht gesetzt sind */
  connected: boolean;
}

export interface OffenseNote {
  id: string;
  offenseId: string;
  content: string;
  author: string;
  createdAt: string;
}

export const qradarApi = {
  stats: (): Promise<{ data: QRadarStats }> =>
    api.get('/qradar/stats'),

  offenses: (filter: 'OPEN' | 'ALL' = 'OPEN'): Promise<{ data: QRadarOffense[] }> =>
    api.get(`/qradar/offenses?filter=${filter}`),

  offense: (id: number): Promise<{ data: QRadarOffense }> =>
    api.get(`/qradar/offenses/${id}`),

  events: (id: number): Promise<{ data: QRadarEvent[] }> =>
    api.get(`/qradar/offenses/${id}/events`),

  getOffenseNotes: (offenseId: string): Promise<{ data: OffenseNote[] }> =>
    api.get(`/qradar/offenses/${offenseId}/notes`),

  addOffenseNote: (offenseId: string, content: string): Promise<{ data: OffenseNote }> =>
    api.post(`/qradar/offenses/${offenseId}/notes`, { content }),
};
