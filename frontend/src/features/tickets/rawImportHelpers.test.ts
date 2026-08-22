/**
 * rawImportHelpers.test.ts — TDD-First
 *
 * Testet rawImportToFormPatch: mappt die ImportRawResponse des Smart-Parsers
 * auf Editor-Formfelder.
 *
 * KEIN Buffer, KEIN Node-only-Import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock apiClient ───────────────────────────────────────────────────────────
vi.mock('../../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));

import { rawImportToFormPatch, rawImportToPayloads } from './rawImportHelpers';
import type { ImportRawResponse } from './ticketApi';

// ─── rawImportToFormPatch ─────────────────────────────────────────────────────

describe('rawImportToFormPatch', () => {
  it('extrahiert srcIp aus IP-Evidence', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'IP',
        evidence: { payload: { ip: '192.168.241.50' } } as never,
        iocs: [{ type: 'ip', value: '192.168.241.50' }],
      },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.srcIp).toBe('192.168.241.50');
  });

  it('extrahiert iocs als Zeilenliste aus iocs-Array', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'Hash',
        evidence: {} as never,
        iocs: [
          { type: 'hash', value: 'd41d8cd98f00b204e9800998ecf8427e' },
          { type: 'ip', value: '1.2.3.4' },
        ],
      },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.iocs).toContain('d41d8cd98f00b204e9800998ecf8427e');
    expect(patch.iocs).toContain('1.2.3.4');
  });

  it('gibt leeres Objekt zurück bei leerer Antwort', () => {
    const resp: ImportRawResponse = {
      data: { type: 'Andere', evidence: {} as never, iocs: [] },
    };
    const patch = rawImportToFormPatch(resp);
    expect(Object.keys(patch).length).toBe(0);
  });

  it('extrahiert hash aus Hash-Evidence', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'Hash',
        evidence: { payload: { hashval: 'abc123def456' } } as never,
        iocs: [{ type: 'hash', value: 'abc123def456' }],
      },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.hash).toBe('abc123def456');
  });

  it('extrahiert url als logs-Hinweis aus URL-Evidence', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'URL',
        evidence: { payload: { url: 'https://evil.example.com/x.exe' } } as never,
        iocs: [{ type: 'url', value: 'https://evil.example.com/x.exe' }],
      },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.iocs).toContain('https://evil.example.com/x.exe');
  });

  it('überschreibt keine vorhandenen iocs wenn bereits Daten vorhanden', () => {
    // rawImportToFormPatch gibt nur ein Patch-Objekt zurück —
    // das Zusammenführen ist Sache des Aufrufers (TicketEditor).
    const resp: ImportRawResponse = {
      data: {
        type: 'IP',
        evidence: {} as never,
        iocs: [{ type: 'ip', value: '10.0.0.1' }],
      },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.iocs).toBeDefined();
  });

  it('gibt kein iocs-Feld zurück wenn iocs-Array leer', () => {
    const resp: ImportRawResponse = {
      data: { type: 'Andere', evidence: {} as never, iocs: [] },
    };
    const patch = rawImportToFormPatch(resp);
    expect(patch.iocs).toBeUndefined();
  });
});

// ─── rawImportToPayloads ─────────────────────────────────────────────────────

describe('rawImportToPayloads', () => {
  it('erzeugt einen TicketPayloadItem mit type und raw wenn payload-Felder vorhanden', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'Hash',
        evidence: { payload: { hashval: 'abc123', algo: 'MD5' } } as never,
        iocs: [],
      },
    };
    const items = rawImportToPayloads(resp, 'abc123');
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('Hash');
    expect(items[0].raw).toBe('abc123');
    expect(items[0].fields.hashval).toBe('abc123');
  });

  it('gibt leeres Array zurück wenn kein payload vorhanden', () => {
    const resp: ImportRawResponse = {
      data: { type: 'Andere', evidence: {} as never, iocs: [] },
    };
    const items = rawImportToPayloads(resp, '');
    expect(items).toHaveLength(0);
  });

  it('erzeugt TicketPayloadItem für IP-Typ', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'IP',
        evidence: { payload: { ip: '1.2.3.4', geo: 'DE' } } as never,
        iocs: [],
      },
    };
    const items = rawImportToPayloads(resp, '1.2.3.4');
    expect(items).toHaveLength(1);
    expect(items[0].fields.ip).toBe('1.2.3.4');
    expect(items[0].fields.geo).toBe('DE');
  });

  it('ignoriert nicht-string payload-Werte graceful', () => {
    const resp: ImportRawResponse = {
      data: {
        type: 'Hash',
        evidence: { payload: { hashval: 'abc', count: 3 as unknown as string } } as never,
        iocs: [],
      },
    };
    const items = rawImportToPayloads(resp, 'abc');
    expect(items[0].fields.hashval).toBe('abc');
    // Nicht-string-Felder werden ignoriert — kein Absturz
  });
});

// ─── templateApi vorlageApi Pfad-Check (für templateApi.ts) ─────────────────

describe('templateApi — Vorlage Pfad + Body', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list ruft GET /analysis-templates auf', async () => {
    const { api } = await import('../../lib/apiClient');
    const mockGet = api.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValueOnce({ data: [], total: 0 });

    const { templateApi } = await import('./templateApi');
    await templateApi.list();

    expect(mockGet).toHaveBeenCalledWith('/analysis-templates');
  });

  it('create ruft POST /analysis-templates mit name + Feldern auf', async () => {
    const { api } = await import('../../lib/apiClient');
    const mockPost = api.post as ReturnType<typeof vi.fn>;
    mockPost.mockResolvedValueOnce({ data: { id: '1', name: 'Test' } });

    const { templateApi } = await import('./templateApi');
    await templateApi.create({ name: 'RDP Brute Force', desc: 'Beschreibung', iocs: '', logs: '', actions: '', rec: '', notes: '' });

    expect(mockPost).toHaveBeenCalledWith(
      '/analysis-templates',
      expect.objectContaining({ name: 'RDP Brute Force', desc: 'Beschreibung' }),
    );
  });

  it('remove ruft DELETE /analysis-templates/:id auf', async () => {
    const { api } = await import('../../lib/apiClient');
    const mockDel = api.del as ReturnType<typeof vi.fn>;
    mockDel.mockResolvedValueOnce(undefined);

    const { templateApi } = await import('./templateApi');
    await templateApi.remove('template-99');

    expect(mockDel).toHaveBeenCalledWith('/analysis-templates/template-99');
  });
});
