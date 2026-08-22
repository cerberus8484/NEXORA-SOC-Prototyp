import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {} });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { getCollectorActivity, sourceLiveness, type SourceActivity } from './collectorsStatusApi';

const mGet = api.get as ReturnType<typeof vi.fn>;

const src = (over: Partial<SourceActivity>): SourceActivity =>
  ({ source: 'dataplane', total: 5, recent: 2, lastSeen: '2026-06-26T10:00:00.000Z', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: { sources: [src({})], liveProcessStatus: { available: false, note: 'geplant' } } });
});

describe('getCollectorActivity', () => {
  test('trifft GET /collectors/activity und gibt die data-Payload zurück', async () => {
    const res = await getCollectorActivity();
    expect(mGet).toHaveBeenCalledWith('/collectors/activity');
    expect(res.sources[0].source).toBe('dataplane');
    expect(res.liveProcessStatus.available).toBe(false);
  });
});

describe('sourceLiveness — ehrlicher Status aus echten Zahlen', () => {
  test('active, wenn in den letzten 24h Daten kamen', () => {
    expect(sourceLiveness(src({ recent: 3 }))).toBe('active');
  });
  test('quiet, wenn früher aktiv aber aktuell still', () => {
    expect(sourceLiveness(src({ recent: 0, lastSeen: '2026-06-01T00:00:00.000Z' }))).toBe('quiet');
  });
  test('none, wenn nie Daten', () => {
    expect(sourceLiveness(src({ recent: 0, lastSeen: null }))).toBe('none');
  });
});
