import { describe, it, expect, vi, beforeEach } from 'vitest';

// API-Client mocken — wir prüfen nur den Vertrag (Pfad + Body), nicht das echte fetch.
vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { api } from '../../lib/apiClient';
import { ticketApi } from './ticketApi';

const mockPost = api.post as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('ticketApi.bulkDelete — Vertrag', () => {
  it('sendet EINEN POST auf /tickets/bulk-delete mit { ids }', async () => {
    mockPost.mockResolvedValue({ data: { requested: 2, deleted: 2, missing: 0, deletedIds: ['a', 'b'] } });

    const res = await ticketApi.bulkDelete(['a', 'b']);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/tickets/bulk-delete', { ids: ['a', 'b'] });
    expect(res.data.deleted).toBe(2);
  });
});
