import { describe, it, expect } from 'vitest';
import { iocCounts, iocConfidence, recommendedBlocks } from './iocsModel';
import { EMPTY_EVIDENCE, type Ioc, type ParsedEvidence } from '../analysisModel';
import type { EntityItem } from '../deckModel';

const ev = (over: Partial<ParsedEvidence> = {}): ParsedEvidence => ({ ...EMPTY_EVIDENCE, ...over });
const iocs: Ioc[] = [
  { type: 'ip', value: '1.2.3.4', reputation: 'malicious' },
  { type: 'ip', value: '5.6.7.8', reputation: 'harmless' },
  { type: 'domain', value: 'bad.test', reputation: 'suspicious' },
  { type: 'hash', value: 'abc' },
];
const entities: EntityItem[] = [{ kind: 'process', value: 'powershell.exe' }, { kind: 'user', value: 'j.bauer' }];

describe('iocCounts', () => {
  it('zählt IoCs je Typ + Entities + MITRE', () => {
    const c = iocCounts(iocs, entities, ev({ metadata: { ...EMPTY_EVIDENCE.metadata, mitreTechnique: 'T1059.001', mitreTactic: 'Execution' } }));
    expect(c.total).toBe(4);
    expect(c.ip).toBe(2);
    expect(c.domain).toBe(1);
    expect(c.hash).toBe(1);
    expect(c.process).toBe(1);
    expect(c.user).toBe(1);
    expect(c.mitre).toBe(2);
  });
  it('mitre ist 0 ohne ATT&CK-Felder', () => {
    expect(iocCounts([], [], EMPTY_EVIDENCE).mitre).toBe(0);
  });
});

describe('iocConfidence', () => {
  it('leitet Confidence aus der Reputation ab', () => {
    expect(iocConfidence('malicious')).toBe('high');
    expect(iocConfidence('suspicious')).toBe('medium');
    expect(iocConfidence('harmless')).toBe('low');
    expect(iocConfidence('unknown')).toBeNull();
    expect(iocConfidence(undefined)).toBeNull();
  });
});

describe('recommendedBlocks', () => {
  it('liefert nur malicious/suspicious IoCs', () => {
    const blocks = recommendedBlocks(iocs);
    expect(blocks.map((i) => i.value)).toEqual(['1.2.3.4', 'bad.test']);
  });
});
