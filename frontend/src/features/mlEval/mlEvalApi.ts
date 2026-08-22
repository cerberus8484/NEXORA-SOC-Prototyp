// ML-Evaluation — read-only Status + Eval-Snapshot-Vorschau (Admin).
//
// GET  /ml/eval/status  — ist eine Routing-Policy aktiv? (kein Dateipfad-Leak)
// POST /ml/eval/export  — bounded, redigierter Eval-Snapshot; hier nur die Meta
//                         (Counts/Label-Verteilung) für die Vorschau, keine Rohdaten.

import { api } from '../../lib/apiClient';

export interface RoutingPolicyStatus {
  active: boolean;
  policyName?: string;
  threshold?: number;
  reason?: string;
}

export interface MlEvalStatus {
  routingPolicy: RoutingPolicyStatus;
}

export interface MlEvalSnapshotMeta {
  schemaVersion: string;
  generatedAt: string;
  recordSha256: string;
  returned: number;
  counts: Record<string, number>;
  labelSourceCounts: Record<string, number>;
  humanLabelCounts: Record<string, number>;
  exportLimit: number;
  include: string;
}

export async function getMlEvalStatus(): Promise<MlEvalStatus> {
  const env = await api.get<{ data: MlEvalStatus }>('/ml/eval/status');
  return env.data;
}

export async function previewEvalSnapshot(limit = 200): Promise<MlEvalSnapshotMeta> {
  const env = await api.post<{ meta: MlEvalSnapshotMeta }>('/ml/eval/export', {
    format: 'json',
    include: 'all',
    limit,
  });
  return env.meta;
}
