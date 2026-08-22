'use strict';

// OIDC In-UI-Admin (P1 #6) — effektive Config aus DB (platform_settings) mit ENV-Fallback.
// Secret liegt verschlüsselt at-rest (secretsCrypto) und verlässt den Read nie im Klartext.

const {
  getEffectiveOidcConfig, readOidcConfigForAdmin, writeOidcConfig, OIDC_SETTING_KEYS,
} = require('../../src/auth/oidc/oidcConfigService');
const { isEncrypted } = require('../../src/config/secretsCrypto');

// Minimaler Settings-Repo-Stub (get → null wenn nicht gesetzt).
function makeRepo(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); },
  };
}

const ENV = {
  enabled: false, issuer: 'https://env-idp.example/realms/soc', clientId: 'env-client',
  clientSecret: 'env-secret', redirectUri: 'https://app/cb', scope: 'openid profile email',
  defaultRole: 'viewer', allowSignup: false,
};

describe('getEffectiveOidcConfig — ENV-Fallback (Seed)', () => {
  it('nutzt ENV-Werte, wenn die DB leer ist', async () => {
    const cfg = await getEffectiveOidcConfig(makeRepo(), ENV);
    expect(cfg).toMatchObject({
      enabled: false, issuer: ENV.issuer, clientId: ENV.clientId,
      clientSecret: ENV.clientSecret, redirectUri: ENV.redirectUri,
      scope: ENV.scope, defaultRole: ENV.defaultRole, allowSignup: false,
    });
  });

  it('DB-Werte haben Vorrang vor ENV', async () => {
    const repo = makeRepo({
      [OIDC_SETTING_KEYS.issuer]: 'https://db-idp/realms/x',
      [OIDC_SETTING_KEYS.clientId]: 'db-client',
      [OIDC_SETTING_KEYS.enabled]: true,
      [OIDC_SETTING_KEYS.allowSignup]: 'true',
    });
    const cfg = await getEffectiveOidcConfig(repo, ENV);
    expect(cfg.issuer).toBe('https://db-idp/realms/x');
    expect(cfg.clientId).toBe('db-client');
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowSignup).toBe(true);
    // ungesetzte Felder fallen weiter auf ENV zurück
    expect(cfg.scope).toBe(ENV.scope);
  });

  it('normalisiert boolean-Strings für enabled/allowSignup', async () => {
    const repo = makeRepo({ [OIDC_SETTING_KEYS.enabled]: 'false', [OIDC_SETTING_KEYS.allowSignup]: true });
    const cfg = await getEffectiveOidcConfig(repo, ENV);
    expect(cfg.enabled).toBe(false);
    expect(cfg.allowSignup).toBe(true);
  });
});

describe('writeOidcConfig + getEffectiveOidcConfig — Secret-Roundtrip', () => {
  it('verschlüsselt das Client-Secret at-rest und entschlüsselt es beim Lesen', async () => {
    const repo = makeRepo();
    await writeOidcConfig(repo, { issuer: 'https://idp/x', clientId: 'c1', clientSecret: 'top-secret' }, ENV);

    // In der DB liegt es verschlüsselt (nie Klartext).
    const stored = await repo.get(OIDC_SETTING_KEYS.clientSecret);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('top-secret');

    const cfg = await getEffectiveOidcConfig(repo, ENV);
    expect(cfg.clientSecret).toBe('top-secret');
  });

  it('ein leeres Secret im Patch überschreibt das gespeicherte NICHT', async () => {
    const repo = makeRepo();
    await writeOidcConfig(repo, { clientSecret: 'keep-me' }, ENV);
    await writeOidcConfig(repo, { issuer: 'https://idp/y', clientSecret: '' }, ENV);
    const cfg = await getEffectiveOidcConfig(repo, ENV);
    expect(cfg.clientSecret).toBe('keep-me');
    expect(cfg.issuer).toBe('https://idp/y');
  });
});

describe('readOidcConfigForAdmin — niemals Secret-Leak', () => {
  it('gibt das Secret NIE zurück, nur clientSecretSet + configured', async () => {
    const repo = makeRepo();
    await writeOidcConfig(repo, { issuer: 'https://idp/x', clientId: 'c1', clientSecret: 's3cr3t' }, ENV);
    const view = await readOidcConfigForAdmin(repo, ENV);

    expect(view).not.toHaveProperty('clientSecret');
    expect(view.clientSecretSet).toBe(true);
    expect(view.configured).toBe(true);
    expect(JSON.stringify(view)).not.toContain('s3cr3t');
  });

  it('configured=false, solange issuer/clientId/secret unvollständig sind', async () => {
    const repo = makeRepo();
    const view = await readOidcConfigForAdmin(repo, { ...ENV, clientSecret: '', issuer: '', clientId: '' });
    expect(view.configured).toBe(false);
    expect(view.clientSecretSet).toBe(false);
  });
});
