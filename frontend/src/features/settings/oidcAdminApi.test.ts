// Vertrags-Tests für die OIDC-Admin-API (P1 #6).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {} });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { getOidcConfig, saveOidcConfig, testOidcConnection, normalizeOidcConfig, type OidcAdminConfig } from './oidcAdminApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;
const mPost = api.post as ReturnType<typeof vi.fn>;

const CONFIG: OidcAdminConfig = {
  enabled: false, issuer: 'https://idp/x', clientId: 'c1', redirectUri: 'https://app/cb',
  scope: 'openid profile email', defaultRole: 'viewer', allowSignup: false,
  clientSecretSet: true, configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: CONFIG });
  mPut.mockResolvedValue({ data: CONFIG });
  mPost.mockResolvedValue({ data: { ok: true, latencyMs: 12, issuer: 'https://idp/x' } });
});

describe('getOidcConfig', () => {
  test('trifft GET /settings/oidc und gibt die data-Payload zurück', async () => {
    const res = await getOidcConfig();
    expect(mGet).toHaveBeenCalledWith('/settings/oidc');
    expect(res.configured).toBe(true);
    expect(res).not.toHaveProperty('clientSecret');
  });
});

describe('normalizeOidcConfig — Boundary-Härtung (verhindert SecurityTab-Crash)', () => {
  test('leeres Array (Catch-all-Shape) → sichere String-Defaults statt undefined', () => {
    const c = normalizeOidcConfig([]);
    expect(c.issuer).toBe('');
    expect(c.clientId).toBe('');
    expect(typeof c.scope).toBe('string');
    expect(c.enabled).toBe(false);
    expect(c.defaultRole).toBe('viewer');
    expect(() => c.issuer.trim()).not.toThrow();
  });

  test('partielle Config → fehlende Felder werden leere Strings', () => {
    const c = normalizeOidcConfig({ enabled: true, issuer: 'https://idp' });
    expect(c.issuer).toBe('https://idp');
    expect(c.clientId).toBe('');
    expect(c.redirectUri).toBe('');
    expect(c.enabled).toBe(true);
  });

  test('null/undefined → vollständige Default-Config (kein Crash)', () => {
    expect(normalizeOidcConfig(null).issuer).toBe('');
    expect(normalizeOidcConfig(undefined).clientId).toBe('');
  });

  test('ungültige defaultRole → viewer', () => {
    expect(normalizeOidcConfig({ defaultRole: 'superadmin' }).defaultRole).toBe('viewer');
  });

  test('getOidcConfig härtet die Antwort: data=[] ergibt keine undefined-Felder', async () => {
    mGet.mockResolvedValueOnce({ data: [] });
    const c = await getOidcConfig();
    expect(c.issuer).toBe('');
    expect(() => `${c.issuer.trim()}${c.clientId.trim()}`).not.toThrow();
  });
});

describe('saveOidcConfig', () => {
  test('trifft PUT /settings/oidc mit Patch + Step-up-Passwort', () => {
    saveOidcConfig({ issuer: 'https://idp/y', clientSecret: 'neu' }, 'pw123');
    expect(mPut).toHaveBeenCalledWith('/settings/oidc', { issuer: 'https://idp/y', clientSecret: 'neu', password: 'pw123' });
  });

  test('reicht HTTP-Fehler weiter (z.B. 403 invalid_password / 400 OIDC_INCOMPLETE)', async () => {
    mPut.mockRejectedValueOnce(new Error('OIDC_INCOMPLETE'));
    await expect(saveOidcConfig({ enabled: true }, 'pw')).rejects.toThrow('OIDC_INCOMPLETE');
  });
});

describe('testOidcConnection', () => {
  test('sendet den Issuer, wenn übergeben', async () => {
    const res = await testOidcConnection('https://idp/x');
    expect(mPost).toHaveBeenCalledWith('/settings/oidc/test', { issuer: 'https://idp/x' });
    expect(res.ok).toBe(true);
  });

  test('sendet leeren Body, wenn kein Issuer übergeben (nutzt gespeicherten)', async () => {
    await testOidcConnection();
    expect(mPost).toHaveBeenCalledWith('/settings/oidc/test', {});
  });
});
