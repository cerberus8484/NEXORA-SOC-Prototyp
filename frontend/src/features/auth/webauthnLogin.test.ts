import { describe, test, expect, vi, beforeEach } from 'vitest';

// api-Client + @simplewebauthn/browser mocken → reine Orchestrierung testbar.
const post = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('../../lib/apiClient', () => ({ api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), del: (...a: unknown[]) => del(...a) } }));
const startRegistration = vi.fn();
const startAuthentication = vi.fn();
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...a: unknown[]) => startRegistration(...a),
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
}));

import { getWebauthnStatus, loginWithPasskey, registerPasskey, listPasskeys, deletePasskey, isPasskeySupported } from './webauthnLogin';

beforeEach(() => { post.mockReset(); get.mockReset(); del.mockReset(); startRegistration.mockReset(); startAuthentication.mockReset(); });

describe('getWebauthnStatus', () => {
  test('fragt /auth/webauthn/status ab', async () => {
    get.mockResolvedValue({ enabled: true });
    expect(await getWebauthnStatus()).toEqual({ enabled: true });
    expect(get).toHaveBeenCalledWith('/auth/webauthn/status', undefined, { signal: undefined });
  });
});

describe('loginWithPasskey', () => {
  test('Options → Browser-Ceremony → verify (in dieser Reihenfolge)', async () => {
    post.mockResolvedValueOnce({ options: { challenge: 'ch' } }); // login/options
    startAuthentication.mockResolvedValueOnce({ id: 'cred', response: {} });
    post.mockResolvedValueOnce({ user: { id: 'u1' } });            // login/verify
    await loginWithPasskey();
    expect(post.mock.calls[0][0]).toBe('/auth/webauthn/login/options');
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'ch' } });
    expect(post.mock.calls[1][0]).toBe('/auth/webauthn/login/verify');
    expect(post.mock.calls[1][1]).toEqual({ response: { id: 'cred', response: {} } });
  });
});

describe('registerPasskey', () => {
  test('Options → startRegistration → verify mit Label; gibt Credential zurück', async () => {
    post.mockResolvedValueOnce({ options: { challenge: 'ch' } });
    startRegistration.mockResolvedValueOnce({ id: 'att' });
    post.mockResolvedValueOnce({ data: { id: 'c1', label: 'YubiKey', transports: ['usb'] } });
    const cred = await registerPasskey('YubiKey');
    expect(cred.label).toBe('YubiKey');
    expect(post.mock.calls[1][1]).toEqual({ response: { id: 'att' }, label: 'YubiKey' });
  });
});

describe('listPasskeys / deletePasskey', () => {
  test('listPasskeys entpackt data[]', async () => {
    get.mockResolvedValue({ data: [{ id: 'c1', label: 'K' }] });
    expect(await listPasskeys()).toEqual([{ id: 'c1', label: 'K' }]);
  });
  test('deletePasskey ruft DELETE auf der id', async () => {
    del.mockResolvedValue({ ok: true });
    await deletePasskey('c1');
    expect(del).toHaveBeenCalledWith('/auth/webauthn/credentials/c1');
  });
});

describe('isPasskeySupported', () => {
  test('true wenn window.PublicKeyCredential existiert', () => {
    (globalThis as unknown as { window?: unknown }).window = { PublicKeyCredential: function () {} };
    expect(isPasskeySupported()).toBe(true);
  });
});
