// TDD RED: Vertrags-Tests für auditApi — prüfen Pfad, Query-Parameter, Rückgabetyp-Vertrag.
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({
    data: [],
    total: 0,
    limit: 50,
    offset: 0,
    requestId: 'test-req',
  });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { auditApi, type AuditListResponse } from './auditApi';

const mGet = api.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({
    data: [],
    total: 0,
    limit: 50,
    offset: 0,
    requestId: 'test-req',
  });
});

describe('auditApi.list', () => {
  test('trifft GET /audit ohne Parameter', () => {
    auditApi.list();
    expect(mGet).toHaveBeenCalledWith('/audit', undefined, undefined);
  });

  test('übergibt action-Filter als Query', () => {
    auditApi.list({ action: 'LOGIN' });
    expect(mGet).toHaveBeenCalledWith('/audit', { action: 'LOGIN' }, undefined);
  });

  test('übergibt limit + offset als Query', () => {
    auditApi.list({ limit: 50, offset: 100 });
    expect(mGet).toHaveBeenCalledWith('/audit', { limit: 50, offset: 100 }, undefined);
  });

  test('übergibt targetType als Query', () => {
    auditApi.list({ targetType: 'ticket' });
    expect(mGet).toHaveBeenCalledWith('/audit', { targetType: 'ticket' }, undefined);
  });

  test('übergibt alle Parameter kombiniert', () => {
    auditApi.list({ limit: 25, offset: 50, action: 'TICKET_CREATE', targetType: 'ticket' });
    expect(mGet).toHaveBeenCalledWith(
      '/audit',
      { limit: 25, offset: 50, action: 'TICKET_CREATE', targetType: 'ticket' },
      undefined
    );
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    auditApi.list(undefined, { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/audit', undefined, { signal: ctrl.signal });
  });

  test('Rückgabetyp enthält data + total + limit + offset', async () => {
    mGet.mockResolvedValueOnce({
      data: [{ id: 'a1', action: 'LOGIN', actorLabel: 'user', targetType: '', targetId: '', ip: '', createdAt: '2026-06-15T10:00:00Z', metadata: {} }],
      total: 42,
      limit: 10,
      offset: 5,
      requestId: 'r1',
    });

    const res: AuditListResponse = await auditApi.list({ limit: 10, offset: 5 });

    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(42);
    expect(res.limit).toBe(10);
    expect(res.offset).toBe(5);
  });
});

describe('auditApi.recent', () => {
  test('trifft GET /audit mit Default-Limit 25', () => {
    auditApi.recent();
    expect(mGet).toHaveBeenCalledWith('/audit', { limit: 25 }, undefined);
  });

  test('übergibt explizites Limit', () => {
    auditApi.recent(10);
    expect(mGet).toHaveBeenCalledWith('/audit', { limit: 10 }, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    auditApi.recent(5, { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/audit', { limit: 5 }, { signal: ctrl.signal });
  });
});

describe('AuditListResponse Typ-Vertrag', () => {
  test('total, limit, offset sind optionale numerische Felder im Response-Typ', async () => {
    // Rückwärts-kompatibel: ohne total/limit/offset (z.B. für Dashboard-Widget)
    mGet.mockResolvedValueOnce({ data: [], requestId: 'r' });
    const res: AuditListResponse = await auditApi.recent();
    expect(res.data).toBeDefined();
    // total kann undefined sein — kein Fehler
  });

  test('mit vollständigem Envelope: alle Felder vorhanden', async () => {
    mGet.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0, requestId: 'r' });
    const res: AuditListResponse = await auditApi.list({ limit: 50, offset: 0 });
    expect(res.total).toBe(0);
    expect(res.limit).toBe(50);
    expect(res.offset).toBe(0);
  });
});
