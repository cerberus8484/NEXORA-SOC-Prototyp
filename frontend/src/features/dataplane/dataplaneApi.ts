// Data-Plane-Pipeline-Status — read-only Live-Sicht über die Hub↔Backend-Status-Brücke.
//
// GET /collectors/pipeline — der Dataplane-Knoten meldet seinen letzten Status
// (Collector-Hub-Zustände + Intake-/Outbox-Zähler) per HMAC ans Backend; hier wird
// die aggregierte, auf Frische geprüfte Sicht geladen. fail-honest: ohne frischen
// Snapshot ist `available=false` — es wird nichts erfunden.

import { api } from '../../lib/apiClient';

export type NodeHealth = 'healthy' | 'degraded' | 'stale';
export type CollectorStatus = 'pending' | 'running' | 'stopped' | 'completed' | 'failed';

export interface CollectorState {
  name: string;
  kind: string;
  status: CollectorStatus;
  emitted: number;
  error: string | null;
}

export interface IntakeCounters {
  total: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  pending: number;
}

export interface OutboxCounters {
  pending: number;
  processing: number;
  completed: number;
  retrying: number;
  failed: number;
  oldestPendingAt: string | null;
}

export interface CollectorsSummary {
  total: number;
  running: number;
  failed: number;
}

export interface PipelineNode {
  nodeId: string;
  reportedAt: string | null;
  receivedAt: string | null;
  collectors: CollectorState[];
  intake: Partial<IntakeCounters>;
  outbox: Partial<OutboxCounters>;
  ageMs: number | null;
  fresh: boolean;
  collectorsSummary: CollectorsSummary;
  health: NodeHealth;
}

export interface PipelineAggregate {
  nodes: number;
  freshNodes: number;
  collectors: number;
  collectorsRunning: number;
  collectorsFailed: number;
  intake: { total: number; rejected: number; pending: number };
  outbox: { pending: number; retrying: number; failed: number };
}

export interface PipelineStatus {
  available: boolean;
  staleAfterMs: number;
  generatedAt: string;
  nodes: PipelineNode[];
  aggregate: PipelineAggregate;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const env = await api.get<{ data: PipelineStatus }>('/collectors/pipeline');
  return env.data;
}
