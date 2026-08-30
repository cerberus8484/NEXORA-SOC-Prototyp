import { api } from '../../lib/apiClient';

export interface HealthResponse {
  status: string;
  db?: string;
  service?: string;
  version?: string;
  env?: string;
  uptime?: number;
}

export interface SystemStats {
  dbEnabled: boolean;
  counts?: {
    tickets: number; ticketsOpen: number; evidence: number; hunts: number;
    findings: number; audit24h: number; fpExceptions: number; users: number;
  };
  byPriority?: Record<string, number>;
  byState?: Record<string, number>;
  storage?: { dbBytes: number; tables: { name: string; bytes: number }[] };
  activity?: { day: string; writes: number }[];
  pool?: {
    total: number;
    idle: number;
    waiting: number;
    max: number;
    saturated: boolean;
  } | null;
}

export interface SystemControlAction {
  id: 'app-restart' | 'app-update';
  name: string;
  description: string;
  kind: 'restart' | 'update';
  requiresReauth: boolean;
  executionMode: 'detached';
  enabled: boolean;
  disabledReason: string | null;
  errorCode: string | null;
  running: boolean;
  repoRoot: string;
  lastResult: {
    actionId: string;
    status: 'accepted' | 'finished' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    pid: number | null;
    exitCode?: number | null;
    signal?: string | null;
  } | null;
}

export interface SystemControlRunResult {
  ok: boolean;
  accepted: boolean;
  actionId: string;
  executionMode: 'detached';
  startedAt: string;
  pid: number | null;
  message: string;
}

export const systemApi = {
  /** Liveness/Readiness — public, kein Auth noetig. */
  health: () => api.get<HealthResponse>('/health'),
  /** Aggregierte DB-Kennzahlen (auth). */
  stats: () => api.get<{ data: SystemStats }>('/system/stats'),
  /** Admin-only System-Ops-Katalog (fail-closed, inklusive Disabled-Gruende). */
  control: () => api.get<{ data: { actions: SystemControlAction[] } }>('/system/control'),
  /** Admin-only Host-Aktion (frische deploy_reauth via X-Reauth-Token). */
  runControlAction: (actionId: SystemControlAction['id'], reauthToken: string) =>
    api.post<{ data: SystemControlRunResult }>(`/system/control/${actionId}`, {}, { headers: { 'X-Reauth-Token': reauthToken } }),
};
