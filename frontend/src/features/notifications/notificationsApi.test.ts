// TDD RED: Vertrags-Tests für notificationsApi
// Prüft Pfade, Query-Parameter, Body, Rückgabetyp-Vertrag.
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: [], total: 0, unreadCount: 0 });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import {
  notificationsApi,
  type Notification,
  type NotificationListResponse,
  type UnreadCountResponse,
} from './notificationsApi';

const mGet  = api.get  as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;

const sampleNotification: Notification = {
  id: 'n1',
  userId: 'u1',
  severity: 'high',
  title: 'Kritischer Alarm',
  body: 'T1055 erkannt',
  source: 'wazuh',
  link: '/tickets/INC000001',
  read: false,
  createdAt: '2026-06-15T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: [], total: 0, unreadCount: 0 });
  mPost.mockResolvedValue({ data: sampleNotification });
});

// ── notificationsApi.list ────────────────────────────────────────────────────

describe('notificationsApi.list', () => {
  test('trifft GET /notifications ohne Parameter', () => {
    notificationsApi.list();
    expect(mGet).toHaveBeenCalledWith('/notifications', {}, undefined);
  });

  test('übergibt unreadOnly=true als Query', () => {
    notificationsApi.list({ unreadOnly: true });
    expect(mGet).toHaveBeenCalledWith('/notifications', { unreadOnly: true }, undefined);
  });

  test('übergibt limit als Query', () => {
    notificationsApi.list({ limit: 8 });
    expect(mGet).toHaveBeenCalledWith('/notifications', { limit: 8 }, undefined);
  });

  test('übergibt unreadOnly + limit kombiniert', () => {
    notificationsApi.list({ unreadOnly: false, limit: 20 });
    expect(mGet).toHaveBeenCalledWith('/notifications', { unreadOnly: false, limit: 20 }, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    notificationsApi.list(undefined, { signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/notifications', {}, { signal: ctrl.signal });
  });

  test('Rückgabetyp enthält data, total, unreadCount', async () => {
    mGet.mockResolvedValueOnce({
      data: [sampleNotification],
      total: 42,
      unreadCount: 5,
    });
    const res: NotificationListResponse = await notificationsApi.list();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('n1');
    expect(res.total).toBe(42);
    expect(res.unreadCount).toBe(5);
  });

  test('Notification-Typ hat alle Pflichtfelder', async () => {
    mGet.mockResolvedValueOnce({ data: [sampleNotification], total: 1, unreadCount: 1 });
    const res = await notificationsApi.list();
    const n = res.data[0];
    expect(n.id).toBeDefined();
    expect(n.userId).toBeDefined();
    expect(n.severity).toMatch(/^(critical|high|medium|low|info)$/);
    expect(n.title).toBeDefined();
    expect(n.body).toBeDefined();
    expect(n.source).toBeDefined();
    expect(typeof n.read).toBe('boolean');
    expect(n.createdAt).toBeDefined();
  });
});

// ── notificationsApi.unreadCount ─────────────────────────────────────────────

describe('notificationsApi.unreadCount', () => {
  test('trifft GET /notifications/unread-count', () => {
    mGet.mockResolvedValueOnce({ data: { count: 3 } });
    notificationsApi.unreadCount();
    expect(mGet).toHaveBeenCalledWith('/notifications/unread-count', undefined, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    mGet.mockResolvedValueOnce({ data: { count: 0 } });
    const ctrl = new AbortController();
    notificationsApi.unreadCount({ signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/notifications/unread-count', undefined, { signal: ctrl.signal });
  });

  test('Rückgabetyp hat data.count als Zahl', async () => {
    mGet.mockResolvedValueOnce({ data: { count: 7 } });
    const res: UnreadCountResponse = await notificationsApi.unreadCount();
    expect(res.data.count).toBe(7);
  });
});

// ── notificationsApi.markRead ────────────────────────────────────────────────

describe('notificationsApi.markRead', () => {
  test('trifft POST /notifications/:id/read', () => {
    notificationsApi.markRead('n42');
    expect(mPost).toHaveBeenCalledWith('/notifications/n42/read', undefined, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    notificationsApi.markRead('n1', { signal: ctrl.signal });
    expect(mPost).toHaveBeenCalledWith('/notifications/n1/read', undefined, { signal: ctrl.signal });
  });

  test('gibt aktualisierte Notification zurück', async () => {
    const updated = { ...sampleNotification, read: true };
    mPost.mockResolvedValueOnce({ data: updated });
    const res = await notificationsApi.markRead('n1');
    expect(res.data.read).toBe(true);
    expect(res.data.id).toBe('n1');
  });
});

// ── notificationsApi.markAllRead ─────────────────────────────────────────────

describe('notificationsApi.markAllRead', () => {
  test('trifft POST /notifications/read-all', () => {
    mPost.mockResolvedValueOnce({ data: { updated: 3 } });
    notificationsApi.markAllRead();
    expect(mPost).toHaveBeenCalledWith('/notifications/read-all', undefined, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    mPost.mockResolvedValueOnce({ data: { updated: 0 } });
    const ctrl = new AbortController();
    notificationsApi.markAllRead({ signal: ctrl.signal });
    expect(mPost).toHaveBeenCalledWith('/notifications/read-all', undefined, { signal: ctrl.signal });
  });

  test('gibt updated-Anzahl zurück', async () => {
    mPost.mockResolvedValueOnce({ data: { updated: 5 } });
    const res = await notificationsApi.markAllRead();
    expect(res.data.updated).toBe(5);
  });
});

// ── Typ-Vollständigkeit: alle Severity-Werte ──────────────────────────────────

describe('Notification.severity Typ-Vertrag', () => {
  const severities: Notification['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];

  severities.forEach((sev) => {
    test(`Severity "${sev}" ist ein gültiger Wert`, () => {
      const n: Notification = { ...sampleNotification, severity: sev };
      expect(n.severity).toBe(sev);
    });
  });
});

// ── link-Feld ist optional ────────────────────────────────────────────────────

describe('Notification.link optional', () => {
  test('link kann undefined/null sein', () => {
    const n: Notification = { ...sampleNotification, link: undefined };
    expect(n.link).toBeUndefined();
  });
});
