import { describe, it, expect } from 'vitest';
import { provenanceLabel, summarizeEvidence, prettyRaw } from './evidenceProvenance';
import type { EvidenceItem } from '../../evidence/evidenceApi';

const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: 'e1', ticketId: 't1', type: 'alert', source: 'wazuh', title: 'Alert', logSource: '', eventId: '', query: '',
  rawText: '', eventTimestamp: null, confidence: null, comment: '', collectedBy: 'a', collectedAt: '2026-06-22T10:00:00Z',
  createdAt: '2026-06-22T10:00:00Z', sha256: 'abc', reviewStatus: 'open', ...over,
});

describe('provenanceLabel', () => {
  it('mappt Quellen auf klare Herkunft', () => {
    expect(provenanceLabel('wazuh')).toBe('Wazuh');
    expect(provenanceLabel('OPNsense-firewall')).toBe('OPNsense');
    expect(provenanceLabel('manual_import')).toBe('manuell importiert');
    expect(provenanceLabel('virustotal')).toBe('VirusTotal');
    expect(provenanceLabel('')).toBe('Unbekannte Quelle');
    expect(provenanceLabel('custom')).toBe('Custom');
  });
});

describe('summarizeEvidence', () => {
  it('zählt nach Herkunft und Review-Status', () => {
    const s = summarizeEvidence([
      item({ source: 'wazuh', reviewStatus: 'verified' }),
      item({ source: 'wazuh', reviewStatus: 'open' }),
      item({ source: 'qradar', reviewStatus: 'reviewed' }),
    ]);
    expect(s.total).toBe(3);
    expect(s.sources[0]).toEqual({ label: 'Wazuh', count: 2 });
    expect(s.review.verified).toBe(1);
    expect(s.verified).toBe(1);
  });
});

describe('prettyRaw', () => {
  it('formatiert JSON hübsch und markiert isJson', () => {
    const r = prettyRaw('{"a":1,"b":2}');
    expect(r.isJson).toBe(true);
    expect(r.text).toContain('\n');
  });
  it('lässt Klartext unverändert und meldet kein JSON', () => {
    expect(prettyRaw('plain log line')).toEqual({ text: 'plain log line', isJson: false });
    expect(prettyRaw('')).toEqual({ text: '', isJson: false });
  });
});
