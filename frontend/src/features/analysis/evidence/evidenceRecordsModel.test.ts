import { describe, it, expect } from 'vitest';
import { buildEvidenceRecords, facetsOf, filterRecords, EMPTY_FILTER } from './evidenceRecordsModel';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';
import type { EvidenceItem } from '../../evidence/evidenceApi';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const evProcess = (): ParsedEvidence => ({
  ...EMPTY_EVIDENCE,
  detection: { ...EMPTY_EVIDENCE.detection, timestamp: '2026-06-22T10:00:00Z', sourceSystem: 'wazuh', severity: 'High', ruleId: '92213' },
  source: { ...EMPTY_EVIDENCE.source, host: 'WEC01', user: 'j.bauer', ip: '10.99.99.11' },
  metadata: { ...EMPTY_EVIDENCE.metadata, mitreTechnique: 'T1059.001' },
  process: { image: 'powershell.exe', commandLine: 'powershell -EncodedCommand SQBFAFgA', hashes: `sha256=${SHA}` },
});
const storedItem = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: 's1', ticketId: 't1', type: 'alert', source: 'manual', title: 'Manueller Hinweis', logSource: '', eventId: '', query: '',
  rawText: '{"k":1}', eventTimestamp: '2026-06-22T09:00:00Z', confidence: null, comment: '', collectedBy: 'a',
  collectedAt: '2026-06-22T09:00:00Z', createdAt: '2026-06-22T09:00:00Z', sha256: SHA, reviewStatus: 'open', ...over,
});

describe('buildEvidenceRecords', () => {
  it('baut ein Primär-Event aus der geparsten Evidence (Process Create, MITRE, Hash, decoded)', () => {
    const recs = buildEvidenceRecords(ticket(), evProcess(), null, []);
    const primary = recs.find((r) => r.kind === 'parsed')!;
    expect(primary.eventType).toBe('Process Create');
    expect(primary.title).toBe('powershell.exe');
    expect(primary.hasMitre).toBe(true);
    expect(primary.hasFileHash).toBe(true);
    expect(primary.hasUser).toBe(true);
    expect(primary.decoded).toBeTruthy();
    expect(primary.provenance).toBe('Wazuh');
  });

  it('ergänzt gesicherte Snapshots und Flow-Events', () => {
    const tl = { count: 1, first: null, last: null, dstPorts: [], actions: [], events: [{ time: '2026-06-22T08:00:00Z', srcIp: '10.0.0.1', dstIp: '8.8.8.8', action: 'block', level: 12 }] };
    const recs = buildEvidenceRecords(ticket(), evProcess(), tl, [storedItem()]);
    expect(recs.find((r) => r.kind === 'stored')?.provenance).toBe('manuell importiert');
    const flow = recs.find((r) => r.kind === 'flow')!;
    expect(flow.severity).toBe('High'); // level 12 -> High
    expect(flow.eventType).toBe('Firewall block');
  });

  it('liefert KEINE Records ohne echte Evidence', () => {
    expect(buildEvidenceRecords(ticket(), EMPTY_EVIDENCE, null, [])).toHaveLength(0);
  });
});

describe('facets + filter', () => {
  it('Facetten + Filter (Severity, Has User, Suche) arbeiten auf echten Records', () => {
    const recs = buildEvidenceRecords(ticket(), evProcess(), null, [storedItem()]);
    const f = facetsOf(recs);
    expect(f.sources).toEqual(expect.arrayContaining(['Wazuh', 'manuell importiert']));
    expect(filterRecords(recs, { ...EMPTY_FILTER, hasUser: true })).toHaveLength(1); // nur das Primär-Event hat User
    expect(filterRecords(recs, { ...EMPTY_FILTER, severity: 'Info' }).every((r) => r.severity === 'Info')).toBe(true);
    expect(filterRecords(recs, { ...EMPTY_FILTER, q: 'powershell' })).toHaveLength(1);
  });
});
