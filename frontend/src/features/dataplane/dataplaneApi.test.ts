import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {} });
  return { api: { get: make(), post: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { getPipelineStatus } from './dataplaneApi';

const mGet = api.get as ReturnType<typeof vi.fn>;

const SAMPLE = {
  available: true,
  staleAfterMs: 90000,
  generatedAt: '2026-06-30T12:00:00.000Z',
  nodes: [{
    nodeId: 'dp-prod-1', reportedAt: '2026-06-30T11:59:50.000Z', receivedAt: '2026-06-30T11:59:50.000Z',
    collectors: [{ name: 'cowrie', kind: 'siem', status: 'running', emitted: 7, error: null }],
    intake: { total: 50 }, outbox: { pending: 1 },
    ageMs: 10000, fresh: true, collectorsSummary: { total: 1, running: 1, failed: 0 }, health: 'healthy',
  }],
  aggregate: {
    nodes: 1, freshNodes: 1, collectors: 1, collectorsRunning: 1, collectorsFailed: 0,
    intake: { total: 50, rejected: 0, pending: 2 }, outbox: { pending: 1, retrying: 0, failed: 0 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: SAMPLE });
});

describe('getPipelineStatus', () => {
  test('trifft GET /collectors/pipeline und entpackt data', async () => {
    const res = await getPipelineStatus();
    expect(mGet).toHaveBeenCalledWith('/collectors/pipeline');
    expect(res.available).toBe(true);
    expect(res.nodes[0].nodeId).toBe('dp-prod-1');
    expect(res.aggregate.collectorsRunning).toBe(1);
  });
});
