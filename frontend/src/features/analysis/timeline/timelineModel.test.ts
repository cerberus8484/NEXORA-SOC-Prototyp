import { describe, it, expect } from 'vitest';
import { buildTimelineGroups, relativeOffset, timelineSources, CATEGORY_LABEL } from './timelineModel';
import { EMPTY_EVIDENCE, type ParsedEvidence, type TicketTimeline } from '../analysisModel';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({ ...EMPTY_EVIDENCE, ...over });
const tl = (events: TicketTimeline['events'], over: Partial<TicketTimeline> = {}): TicketTimeline => ({
  count: events.length, first: null, last: null, dstPorts: [], actions: [], events, ...over,
});

describe('buildTimelineGroups', () => {
  it('baut Process/Script/File/Detection-Gruppen aus realer Evidence', () => {
    const groups = buildTimelineGroups(ticket(), ev({
      detection: { sourceSystem: 'Wazuh', timestamp: '2026-06-20T16:49:32Z', ruleId: '92213', ruleName: 'Executable dropped', severity: '15' },
      source: { ...EMPTY_EVIDENCE.source, host: 'WindowsClient', user: 'CERBERUS\\Admin' },
      process: { ...EMPTY_EVIDENCE.process, image: 'C:\\Windows\\powershell.exe', commandLine: 'powershell.exe -NoP -Enc ZQBjAGgAbwА=', processId: '6448' },
      file: { ...EMPTY_EVIDENCE.file, name: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\x.ps1', hashes: 'MD5=3f2e8b1c' },
    }), null);
    const ids = groups.map((g) => g.id);
    expect(ids).toContain('process');
    expect(ids).toContain('script');
    expect(ids).toContain('file');
    expect(ids).toContain('detection');

    const proc = groups.find((g) => g.id === 'process')!;
    expect(proc.title).toBe('Process created: powershell.exe');
    expect(proc.meta.find((m) => m.label === 'Host')?.value).toBe('WindowsClient');
    expect(proc.meta.find((m) => m.label === 'PID')?.value).toBe('6448');

    const file = groups.find((g) => g.id === 'file')!;
    expect(file.sub.some((s) => s.text.includes('File created:'))).toBe(true);
    expect(file.sub.some((s) => s.text.startsWith('MD5:'))).toBe(true);

    const det = groups.find((g) => g.id === 'detection')!;
    expect(det.sub[0].text).toContain('92213');
  });

  it('baut eine Network-Gruppe aus Timeline-Flow-Events mit echten Zeiten', () => {
    const groups = buildTimelineGroups(ticket(), EMPTY_EVIDENCE, tl([
      { time: '2026-06-20T16:50:12Z', srcIp: '192.168.241.102', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp', action: 'allow' },
    ]));
    const net = groups.find((g) => g.id === 'network')!;
    expect(net).toBeTruthy();
    expect(net.category).toBe('network');
    expect(net.sub[0].text).toContain('203.0.113.45:443');
    expect(net.time).toBe('2026-06-20T16:50:12Z');
  });

  it('nutzt die Destination-Zusammenfassung, wenn keine Flows/Events da sind', () => {
    const groups = buildTimelineGroups(ticket(), ev({ destination: { ...EMPTY_EVIDENCE.destination, ip: '203.0.113.45', port: 443 }, network: { ...EMPTY_EVIDENCE.network, protocol: 'tcp' } }), null);
    const net = groups.find((g) => g.id === 'network')!;
    expect(net.sub[0].text).toBe('Connection to 203.0.113.45:443 (TCP)');
  });

  it('ist leer ohne jede Evidence', () => {
    expect(buildTimelineGroups(ticket(), EMPTY_EVIDENCE, null)).toHaveLength(0);
  });

  it('sortiert chronologisch (älteste zuerst)', () => {
    const groups = buildTimelineGroups(ticket(), ev({
      detection: { sourceSystem: 'Wazuh', timestamp: '2026-06-20T16:49:32Z', ruleId: '92213' },
    }), tl([{ time: '2026-06-20T16:50:12Z', dstIp: '203.0.113.45', dstPort: 443, protocol: 'tcp' }]));
    expect(groups[0].time! <= groups[groups.length - 1].time!).toBe(true);
    expect(groups[0].id).toBe('detection');
    expect(groups[groups.length - 1].id).toBe('network');
  });
});

describe('relativeOffset', () => {
  it('berechnet den Versatz zur Basiszeit', () => {
    expect(relativeOffset('2026-06-20T16:49:32Z', '2026-06-20T16:49:34Z')).toBe('+2s');
    expect(relativeOffset('2026-06-20T16:49:32Z', '2026-06-20T16:52:18Z')).toBe('+2m 46s');
  });
  it('ist leer bei ≤ 0 oder unbekannten Zeiten', () => {
    expect(relativeOffset('2026-06-20T16:49:32Z', '2026-06-20T16:49:32Z')).toBe('');
    expect(relativeOffset(null, '2026-06-20T16:49:32Z')).toBe('');
  });
});

describe('timelineSources', () => {
  it('sammelt verschiedene Sub-Event-Quellen', () => {
    const groups = buildTimelineGroups(ticket(), ev({
      detection: { sourceSystem: 'Wazuh', timestamp: '2026-06-20T16:49:32Z', ruleId: '92213' },
      file: { ...EMPTY_EVIDENCE.file, name: 'x.ps1', hashes: 'MD5=abc' },
    }), null);
    const sources = timelineSources(groups);
    expect(sources).toContain('Wazuh');
    expect(sources).toContain('Sysmon (Event ID 11)');
  });
});

describe('CATEGORY_LABEL', () => {
  it('liefert lesbare Labels', () => {
    expect(CATEGORY_LABEL.script).toBe('Script Execution');
    expect(CATEGORY_LABEL.file).toBe('File Write');
  });
});
