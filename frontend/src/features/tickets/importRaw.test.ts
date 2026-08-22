/**
 * Frontend-Tests für:
 * 1. ticketApi.importRaw — Pfad/Body korrekt
 * 2. tiResultToEnrichment — ThreatIntelResult → EnrichmentData-Mapper
 *
 * KEIN Buffer-Import (Node-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────────────────
vi.mock('../../lib/apiClient', () => ({
  api: {
    get:  vi.fn(),
    post: vi.fn(),
    put:  vi.fn(),
    del:  vi.fn(),
  },
}));

import { api } from '../../lib/apiClient';
import { ticketApi } from './ticketApi';
import { tiResultToEnrichment } from './importHelpers';
import type { ThreatIntelResult } from '../analysis/analysisModel';
import { EMPTY_ENRICHMENT } from '../analysis/analysisModel';

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── ticketApi.importRaw ─────────────────────────────────────────────────────

describe('ticketApi.importRaw', () => {
  it('ruft POST /tickets/:id/import mit korrektem Pfad und Body auf', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { type: 'IP', evidence: {}, iocs: [] }, requestId: 'r1' });

    await ticketApi.importRaw('ticket-123', '1.2.3.4', 'Wazuh Alert');

    expect(mockApi.post).toHaveBeenCalledWith(
      '/tickets/ticket-123/import',
      { raw: '1.2.3.4', sourceType: 'Wazuh Alert' }
    );
  });

  it('gibt die Antwort des Servers zurück', async () => {
    const mockResponse = { data: { type: 'Hash', evidence: { payload: {} }, iocs: [{ type: 'hash', value: 'abc' }] }, requestId: 'r2' };
    mockApi.post.mockResolvedValueOnce(mockResponse);

    const result = await ticketApi.importRaw('ticket-abc', 'd41d8cd98f00b204e9800998ecf8427e', 'manual');
    expect(result).toEqual(mockResponse);
  });

  it('verwendet ticketId korrekt im Pfad', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { type: 'URL', evidence: {}, iocs: [] } });

    await ticketApi.importRaw('my-special-ticket-id', 'https://evil.ru', 'Firewall Log');

    const [path] = mockApi.post.mock.calls[0] as [string, unknown];
    expect(path).toBe('/tickets/my-special-ticket-id/import');
  });
});

// ─── tiResultToEnrichment ────────────────────────────────────────────────────

describe('tiResultToEnrichment', () => {
  it('gibt EMPTY_ENRICHMENT zurück bei null', () => {
    const result = tiResultToEnrichment(null);
    expect(result).toEqual(EMPTY_ENRICHMENT);
  });

  it('gibt EMPTY_ENRICHMENT zurück wenn result.source === mock', () => {
    const ti: ThreatIntelResult = {
      id: '1', indicatorType: 'ip', indicatorValue: '1.2.3.4',
      verdict: 'unknown', confidence: 0, score: 0,
      providers: [], summary: '', tags: [],
      source: 'mock', createdAt: new Date().toISOString(),
    };
    const result = tiResultToEnrichment(ti);
    expect(result.virusTotal.status).toBe('none');
    expect(result.abuseIpDb.status).toBe('none');
  });

  it('füllt virusTotal-Karte wenn VT-Provider ok ist', () => {
    const ti: ThreatIntelResult = {
      id: '2', indicatorType: 'ip', indicatorValue: '185.1.1.1',
      verdict: 'malicious', confidence: 90, score: 85,
      providers: [
        {
          provider: 'virustotal',
          status: 'ok',
          verdict: 'malicious',
          score: 85,
          confidence: 90,
          rawSummary: '7/72 malicious',
          details: { tags: ['malware'] },
        },
      ],
      summary: 'Known C2', tags: ['malware'],
      source: 'provider', createdAt: new Date().toISOString(),
    };

    const result = tiResultToEnrichment(ti);
    expect(result.virusTotal.status).toBe('completed');
    expect(result.virusTotal.malicious).toBeGreaterThanOrEqual(0);
  });

  it('füllt abuseIpDb-Karte wenn AbuseIPDB-Provider ok ist', () => {
    const ti: ThreatIntelResult = {
      id: '3', indicatorType: 'ip', indicatorValue: '8.8.8.8',
      verdict: 'clean', confidence: 5, score: 5,
      providers: [
        {
          provider: 'abuseipdb',
          status: 'ok',
          verdict: 'clean',
          score: 5,
          confidence: 5,
          rawSummary: 'Low risk',
        },
      ],
      summary: 'Clean IP', tags: [],
      source: 'provider', createdAt: new Date().toISOString(),
    };

    const result = tiResultToEnrichment(ti);
    expect(result.abuseIpDb.status).toBe('completed');
    expect(result.abuseIpDb.confidence).toBe(5);
  });

  it('setzt status=none bei not_configured Provider', () => {
    const ti: ThreatIntelResult = {
      id: '4', indicatorType: 'ip', indicatorValue: '9.9.9.9',
      verdict: 'unknown', confidence: 0, score: 0,
      providers: [
        { provider: 'virustotal', status: 'not_configured', verdict: 'unknown', score: 0, confidence: 0 },
        { provider: 'abuseipdb', status: 'not_configured', verdict: 'unknown', score: 0, confidence: 0 },
      ],
      summary: '', tags: [],
      source: 'cache', createdAt: new Date().toISOString(),
    };

    const result = tiResultToEnrichment(ti);
    expect(result.virusTotal.status).toBe('none');
    expect(result.abuseIpDb.status).toBe('none');
  });

  it('setzt indicatorValue als whois.ip', () => {
    const ti: ThreatIntelResult = {
      id: '5', indicatorType: 'ip', indicatorValue: '10.0.0.1',
      verdict: 'clean', confidence: 0, score: 0,
      providers: [],
      summary: '', tags: [],
      source: 'cache', createdAt: new Date().toISOString(),
    };

    const result = tiResultToEnrichment(ti);
    expect(result.whois.ip).toBe('10.0.0.1');
  });
});
