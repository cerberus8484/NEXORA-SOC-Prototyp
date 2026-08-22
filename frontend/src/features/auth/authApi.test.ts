// Vertrags-Tests für authApi — Pfad, Body, Rückgabetyp. apiClient gemockt.

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({});
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { authApi, type MfaVerifyResponse } from './authApi';

const mPost = api.post as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authApi.changePassword', () => {
  test('trifft POST /auth/change-password mit current + new', async () => {
    mPost.mockResolvedValueOnce({ ok: true });
    await authApi.changePassword('OldPass1!', 'NewPass99!');
    expect(mPost).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass99!',
    });
  });
});

describe('authApi.verifyMfa', () => {
  test('trifft POST /auth/mfa mit challengeToken + code', async () => {
    mPost.mockResolvedValueOnce({ token: 't', user: { id: 'u1', email: 'a@b.de', role: 'analyst' } });
    await authApi.verifyMfa('chal-123', '123456');
    expect(mPost).toHaveBeenCalledWith('/auth/mfa', { challengeToken: 'chal-123', code: '123456' });
  });

  test('reicht Recovery-Code unverändert durch', async () => {
    mPost.mockResolvedValueOnce({ token: 't', user: { id: 'u1', email: 'a@b.de', role: 'analyst' } });
    await authApi.verifyMfa('chal-123', 'ABCD1234');
    expect(mPost).toHaveBeenCalledWith('/auth/mfa', { challengeToken: 'chal-123', code: 'ABCD1234' });
  });

  test('Rückgabetyp exponiert user (Session via httpOnly-Cookie, kein Token im FE)', async () => {
    // Backend liefert über die Leitung auch ein token-Feld; der FE-Typ exponiert es
    // bewusst NICHT (Footgun-Schutz) — die Session trägt der httpOnly-Cookie.
    mPost.mockResolvedValueOnce({
      token: 'session-token',
      user: { id: 'u1', email: 'a@b.de', role: 'admin' },
    });
    const res: MfaVerifyResponse = await authApi.verifyMfa('chal', '123456');
    expect(res.user.email).toBe('a@b.de');
    expect('token' in res).toBe(true); // kommt über die Leitung, ist aber untypisiert
  });

  test('falscher Code → Fehler wird durchgereicht (apiClient wirft bei 401)', async () => {
    mPost.mockRejectedValueOnce(new Error('Nicht authentifiziert'));
    await expect(authApi.verifyMfa('chal', '000000')).rejects.toThrow('Nicht authentifiziert');
  });
});
