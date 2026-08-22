import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Tests — qradarApi Notizen-Erweiterung
 *
 * Kein Buffer-Import (Frontend-Test-Falle).
 * Mockt api direkt per vi.mock.
 */

vi.mock('../../lib/apiClient', () => ({
  api: {
    get:  vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../../lib/apiClient';
import { qradarApi } from './qradarApi';

 
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('qradarApi.getOffenseNotes()', () => {
  test('ruft GET /qradar/offenses/:id/notes auf', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [] });
    await qradarApi.getOffenseNotes('42');
    expect(mockApi.get).toHaveBeenCalledWith('/qradar/offenses/42/notes');
  });

  test('gibt data-Array zurück', async () => {
    const notes = [
      { id: 'n1', offenseId: '42', content: 'Test', author: 'a@b.de', createdAt: '2026-06-14T10:00:00Z' },
    ];
    mockApi.get.mockResolvedValueOnce({ data: notes });
    const result = await qradarApi.getOffenseNotes('42');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].content).toBe('Test');
  });

  test('gibt leere Liste zurück wenn keine Notizen', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [] });
    const result = await qradarApi.getOffenseNotes('99');
    expect(result.data).toEqual([]);
  });
});

describe('qradarApi.addOffenseNote()', () => {
  test('ruft POST /qradar/offenses/:id/notes mit content auf', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { id: 'n1', content: 'Neue Notiz' } });
    await qradarApi.addOffenseNote('42', 'Neue Notiz');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/qradar/offenses/42/notes',
      { content: 'Neue Notiz' },
    );
  });

  test('gibt die erstellte Notiz zurück', async () => {
    const note = { id: 'n2', offenseId: '42', content: 'Gespeichert', author: 'x@y.de', createdAt: '2026-06-14T11:00:00Z' };
    mockApi.post.mockResolvedValueOnce({ data: note });
    const result = await qradarApi.addOffenseNote('42', 'Gespeichert');
    expect(result.data.id).toBe('n2');
    expect(result.data.content).toBe('Gespeichert');
  });
});
