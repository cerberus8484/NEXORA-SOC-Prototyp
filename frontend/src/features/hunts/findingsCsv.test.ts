import { describe, test, expect } from 'vitest';
import { escapeCsvField, findingsToCsv } from './findingsCsv';
import type { HuntFinding } from '../../lib/types';

const mk = (over: Partial<HuntFinding>): HuntFinding => ({
  id: 'f1', sessionId: 's1', title: 'Title', description: 'Desc',
  severity: 'high', confidence: 'medium', artifactIds: [], mitreAttack: '',
  recommendation: '', analystId: 'ana', ticketId: null,
  verdict: '',
  context: {}, createdAt: '2026-06-13T10:00:00.000Z', updatedAt: '2026-06-13T10:00:00.000Z',
  ...over,
});

describe('escapeCsvField', () => {
  test('quotet Felder mit Komma und verdoppelt innere Anführungszeichen', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField(null)).toBe('');
  });
});

describe('findingsToCsv', () => {
  test('Header + eine Zeile je Finding, korrekte Reihenfolge', () => {
    const csv = findingsToCsv([
      mk({ id: 'a', severity: 'critical', title: 'T1', description: 'D1', createdAt: '2026-06-13T01:00:00Z' }),
      mk({ id: 'b', severity: 'low', title: 'T2', description: 'D2', createdAt: '2026-06-13T02:00:00Z' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,severity,title,description,createdAt');
    expect(lines[1]).toBe('a,critical,T1,D1,2026-06-13T01:00:00Z');
    expect(lines[2]).toBe('b,low,T2,D2,2026-06-13T02:00:00Z');
    expect(lines).toHaveLength(3);
  });

  test('leere Findings-Liste → nur Header', () => {
    expect(findingsToCsv([])).toBe('id,severity,title,description,createdAt');
  });
});
