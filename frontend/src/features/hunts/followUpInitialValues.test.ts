import { describe, test, expect } from 'vitest';
import { followUpInitialValues } from './followUpInitialValues';
import type { HuntFinding, HuntSession } from '../../lib/types';

const mkFinding = (over: Partial<HuntFinding> = {}): HuntFinding => ({
  id: 'f1', sessionId: 's1', title: 'T', description: '',
  severity: 'high', confidence: 'medium', artifactIds: [], mitreAttack: '',
  recommendation: '', analystId: 'ana', ticketId: null, verdict: '',
  context: {}, createdAt: '2026-06-14T10:00:00.000Z', updatedAt: '2026-06-14T10:00:00.000Z',
  ...over,
});

const mkSession = (over: Partial<HuntSession> = {}): HuntSession => ({
  id: 's1', ticketId: null, analystId: 'ana', targetHost: 'SESSION-HOST', scope: '',
  hypothesis: '', status: 'active', huntType: 'lateral', title: 'Sess', riskLevel: 'high',
  summary: '', findingsCount: 0, createdAt: '', updatedAt: '', startedAt: null, closedAt: null,
  ...over,
});

describe('followUpInitialValues — Ableitung aus Finding + Session', () => {
  test('leeres Objekt, wenn kein Finding', () => {
    expect(followUpInitialValues(null, mkSession())).toEqual({});
    expect(followUpInitialValues(undefined, mkSession())).toEqual({});
  });

  test('targetHost bevorzugt finding.context.host vor session.targetHost', () => {
    const f = mkFinding({ context: { host: 'FINDING-HOST' } });
    expect(followUpInitialValues(f, mkSession()).targetHost).toBe('FINDING-HOST');
  });

  test('targetHost fällt auf session.targetHost zurück, wenn context.host fehlt', () => {
    const f = mkFinding({ context: {} });
    expect(followUpInitialValues(f, mkSession()).targetHost).toBe('SESSION-HOST');
  });

  test('sourceIp wird übernommen, wenn im Finding-Kontext vorhanden', () => {
    const f = mkFinding({ context: { sourceIp: '10.0.0.5' } });
    expect(followUpInitialValues(f, mkSession()).sourceIp).toBe('10.0.0.5');
  });

  test('sourceIp bleibt weg, wenn nicht gesetzt', () => {
    const f = mkFinding({ context: {} });
    expect(followUpInitialValues(f, mkSession())).not.toHaveProperty('sourceIp');
  });

  test('ticketId bevorzugt finding.ticketId vor session.ticketId', () => {
    const f = mkFinding({ ticketId: 'ticket-finding' });
    const se = mkSession({ ticketId: 'ticket-session' });
    expect(followUpInitialValues(f, se).ticketId).toBe('ticket-finding');
  });

  test('ticketId fällt auf session.ticketId zurück', () => {
    const f = mkFinding({ ticketId: null });
    const se = mkSession({ ticketId: 'ticket-session' });
    expect(followUpInitialValues(f, se).ticketId).toBe('ticket-session');
  });

  test('kein ticketId, wenn weder Finding noch Session eines hat', () => {
    const f = mkFinding({ ticketId: null });
    const se = mkSession({ ticketId: null });
    expect(followUpInitialValues(f, se)).not.toHaveProperty('ticketId');
  });

  test('leere Strings zählen als nicht gesetzt', () => {
    const f = mkFinding({ ticketId: '  ', context: { host: '' } });
    const se = mkSession({ targetHost: 'FALLBACK', ticketId: '' });
    const r = followUpInitialValues(f, se);
    expect(r.targetHost).toBe('FALLBACK');
    expect(r).not.toHaveProperty('ticketId');
  });

  test('funktioniert ohne Session (undefined)', () => {
    const f = mkFinding({ context: { host: 'H', sourceIp: '1.2.3.4' }, ticketId: 't1' });
    expect(followUpInitialValues(f, undefined)).toEqual({ targetHost: 'H', sourceIp: '1.2.3.4', ticketId: 't1' });
  });
});
