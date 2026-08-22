// TDD RED: Vertrags-Tests für notificationsApi.getChannels()
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({});
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { notificationsApi, type ChannelsResponse, type ChannelStatus } from './notificationsApi';

const mGet = api.get as ReturnType<typeof vi.fn>;

const sampleChannels: ChannelsResponse = {
  outboundEnabled: false,
  channels: [
    { id: 'slack',   configured: false },
    { id: 'webhook', configured: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue(sampleChannels);
});

// ── getChannels() ─────────────────────────────────────────────────────────────

describe('notificationsApi.getChannels', () => {
  test('trifft GET /notifications/channels', () => {
    notificationsApi.getChannels();
    expect(mGet).toHaveBeenCalledWith('/notifications/channels', undefined, undefined);
  });

  test('leitet AbortSignal weiter', () => {
    const ctrl = new AbortController();
    notificationsApi.getChannels({ signal: ctrl.signal });
    expect(mGet).toHaveBeenCalledWith('/notifications/channels', undefined, { signal: ctrl.signal });
  });

  test('gibt outboundEnabled als boolean zurück', async () => {
    const res: ChannelsResponse = await notificationsApi.getChannels();
    expect(typeof res.outboundEnabled).toBe('boolean');
  });

  test('gibt channels-Array zurück', async () => {
    const res: ChannelsResponse = await notificationsApi.getChannels();
    expect(Array.isArray(res.channels)).toBe(true);
  });

  test('jeder channel hat id (string) und configured (boolean)', async () => {
    const res: ChannelsResponse = await notificationsApi.getChannels();
    for (const ch of res.channels) {
      expect(typeof ch.id).toBe('string');
      expect(typeof ch.configured).toBe('boolean');
    }
  });

  test('ChannelStatus-Typ: id und configured sind Pflichtfelder', () => {
    const ch: ChannelStatus = { id: 'slack', configured: true };
    expect(ch.id).toBe('slack');
    expect(ch.configured).toBe(true);
  });

  test('gibt "Versand aktiv" nur wenn outboundEnabled=true UND configured=true', async () => {
    // Test der Logik-Helfer-Funktion (importiert aus notificationsHelpers)
    // Diese Funktion ist Teil des Display-Vertrags.
    const { isChannelActive } = await import('./notificationsHelpers');

    expect(isChannelActive(true,  true)).toBe(true);
    expect(isChannelActive(true,  false)).toBe(false);
    expect(isChannelActive(false, true)).toBe(false);
    expect(isChannelActive(false, false)).toBe(false);
  });

  // SECRET-LEAK: Die API-Funktion darf keine URLs oder Secrets weitergeben.
  // Der Vertrag ist: NUR Boolean-Felder in der Response.
  test('SECRET-LEAK: ChannelsResponse enthält keine URL-Felder', async () => {
    const res = await notificationsApi.getChannels();
    const str = JSON.stringify(res);

    expect(str).not.toMatch(/https?:\/\//);
    expect(str).not.toMatch(/webhookUrl/i);
    expect(str).not.toMatch(/secret/i);
    expect(str).not.toMatch(/token/i);
  });

  test('Fehler-Pfad: wirft wenn API fehlschlägt', async () => {
    mGet.mockRejectedValueOnce(new Error('Network error'));
    await expect(notificationsApi.getChannels()).rejects.toThrow('Network error');
  });
});

// ── Default-Zustand (inert-by-default) ───────────────────────────────────────

describe('ChannelsResponse Default-Zustand', () => {
  test('outboundEnabled=false entspricht dem inerten Default-Zustand', async () => {
    mGet.mockResolvedValueOnce({ outboundEnabled: false, channels: [{ id: 'slack', configured: false }] });
    const res = await notificationsApi.getChannels();
    expect(res.outboundEnabled).toBe(false);
  });

  test('configured=false wenn keine URL gesetzt', async () => {
    mGet.mockResolvedValueOnce({
      outboundEnabled: false,
      channels: [
        { id: 'slack',   configured: false },
        { id: 'webhook', configured: false },
      ],
    });
    const res = await notificationsApi.getChannels();
    expect(res.channels.every((c) => !c.configured)).toBe(true);
  });
});
