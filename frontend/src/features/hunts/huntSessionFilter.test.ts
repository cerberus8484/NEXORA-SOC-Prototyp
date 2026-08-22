import { describe, test, expect } from 'vitest';
import { filterSessions, type SessionFilter } from './huntSessionFilter';
import type { HuntSession } from '../../lib/types';

const NOW = new Date('2026-06-13T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const sessions = [
  { id: '1', targetHost: 'WindowsClient', scope: 'lateral movement', analystId: 'ana-aaa', status: 'active', createdAt: ago(3_600_000) },          // 1h
  { id: '2', targetHost: 'dc01', scope: 'persistence', analystId: 'ana-bbb', status: 'completed', createdAt: ago(3 * 86_400_000) },                  // 3d
  { id: '3', targetHost: 'srv-web', scope: 'c2 beacon', analystId: 'ana-aaa', status: 'active', createdAt: ago(20 * 86_400_000) },                   // 20d
] as unknown as HuntSession[];

const f = (over: Partial<SessionFilter> = {}): SessionFilter => ({ q: '', status: '', analyst: '', range: '', ...over });

describe('filterSessions', () => {
  test('leerer Filter → alle', () => {
    expect(filterSessions(sessions, f(), NOW)).toHaveLength(3);
  });

  test('Zeitraum 24h → nur die jüngste', () => {
    const r = filterSessions(sessions, f({ range: '24h' }), NOW);
    expect(r.map((s) => s.id)).toEqual(['1']);
  });

  test('Zeitraum 7d → die ersten beiden', () => {
    const r = filterSessions(sessions, f({ range: '7d' }), NOW);
    expect(r.map((s) => s.id)).toEqual(['1', '2']);
  });

  test('Status + Zeitraum kombiniert', () => {
    const r = filterSessions(sessions, f({ status: 'active', range: '30d' }), NOW);
    expect(r.map((s) => s.id)).toEqual(['1', '3']);
  });

  test('Analyst-Filter', () => {
    expect(filterSessions(sessions, f({ analyst: 'ana-bbb' }), NOW).map((s) => s.id)).toEqual(['2']);
  });

  test('Suche über host/scope/analyst', () => {
    expect(filterSessions(sessions, f({ q: 'beacon' }), NOW).map((s) => s.id)).toEqual(['3']);
    expect(filterSessions(sessions, f({ q: 'DC01' }), NOW).map((s) => s.id)).toEqual(['2']);
  });

  test('unbekannter Range → kein Zeitfilter (alle)', () => {
    expect(filterSessions(sessions, f({ range: 'xyz' }), NOW)).toHaveLength(3);
  });
});
