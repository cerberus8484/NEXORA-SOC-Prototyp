import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportDraft, type ExportResult } from './useCaseDeveloperApi';
import { api } from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  api: {
    get:  vi.fn(),
    post: vi.fn(),
  },
}));

const mockGet = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportDraft', () => {
  it('ruft GET /use-case-drafts/:id/export?format=sigma auf', async () => {
    const payload: ExportResult = { format: 'sigma', language: 'sigma', content: 'title: Test' };
    mockGet.mockResolvedValueOnce({ data: payload });

    const result = await exportDraft('draft-1', 'sigma');

    expect(mockGet).toHaveBeenCalledWith('/use-case-drafts/draft-1/export', { format: 'sigma' });
    expect(result.format).toBe('sigma');
    expect(result.content).toBe('title: Test');
    expect(result.language).toBe('sigma');
  });

  it('ruft GET mit format=wazuh auf', async () => {
    const payload: ExportResult = { format: 'wazuh', language: 'xml', content: '<rule id="100500"' };
    mockGet.mockResolvedValueOnce({ data: payload });

    const result = await exportDraft('draft-2', 'wazuh');
    expect(mockGet).toHaveBeenCalledWith('/use-case-drafts/draft-2/export', { format: 'wazuh' });
    expect(result.format).toBe('wazuh');
  });

  it('ruft GET mit format=splunk auf', async () => {
    const payload: ExportResult = { format: 'splunk', language: 'spl', content: 'index=* | search ...' };
    mockGet.mockResolvedValueOnce({ data: payload });

    const result = await exportDraft('abc', 'splunk');
    expect(mockGet).toHaveBeenCalledWith('/use-case-drafts/abc/export', { format: 'splunk' });
    expect(result.language).toBe('spl');
  });

  it('ruft GET mit format=qradar auf', async () => {
    const payload: ExportResult = { format: 'qradar', language: 'aql', content: 'SELECT * FROM events' };
    mockGet.mockResolvedValueOnce({ data: payload });

    const result = await exportDraft('xyz', 'qradar');
    expect(mockGet).toHaveBeenCalledWith('/use-case-drafts/xyz/export', { format: 'qradar' });
    expect(result.content).toContain('FROM events');
  });

  it('gibt ExportResult zurück (nicht das rohe { data: ... })', async () => {
    const payload: ExportResult = { format: 'sigma', language: 'sigma', content: 'title: x' };
    mockGet.mockResolvedValueOnce({ data: payload });

    const result = await exportDraft('d', 'sigma');
    // result soll direkt die ExportResult-Felder haben, NICHT { data: ExportResult }
    expect(result.format).toBeDefined();
    expect(result.content).toBeDefined();
    expect((result as unknown as { data?: unknown }).data).toBeUndefined();
  });

  it('wirft wenn api.get fehlschlägt (Network-Error)', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    await expect(exportDraft('d', 'sigma')).rejects.toThrow('Network error');
  });

  it('wirft wenn Server 400 zurückgibt (unbekanntes Format)', async () => {
    const err = Object.assign(new Error('Bad Request'), { statusCode: 400 });
    mockGet.mockRejectedValueOnce(err);
    await expect(exportDraft('d', 'bad-format')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('wirft wenn Server 404 zurückgibt (Draft nicht gefunden)', async () => {
    const err = Object.assign(new Error('Not Found'), { statusCode: 404 });
    mockGet.mockRejectedValueOnce(err);
    await expect(exportDraft('nonexistent', 'sigma')).rejects.toMatchObject({ statusCode: 404 });
  });
});
