'use strict';

// OIDC Slice 2 — Account-Linking-Fundament: User trägt oidcSub/oidcProvider,
// Repos finden einen User über seine externe Identität (Parität InMemory/Postgres).
const { User }                   = require('../../src/domain/User');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { PostgresUserRepository } = require('../../src/repositories/PostgresUserRepository');

const ISSUER = 'https://idp.example.com/realms/soc';

describe('User — OIDC-Identitätsfelder', () => {
  test('Default: oidcSub/oidcProvider sind null (kein Auto-Link)', () => {
    const u = new User({ email: 'a@b.de' });
    expect(u.oidcSub).toBeNull();
    expect(u.oidcProvider).toBeNull();
  });

  test('Konstruktor übernimmt oidcSub/oidcProvider', () => {
    const u = new User({ email: 'a@b.de', oidcSub: 'sub-123', oidcProvider: ISSUER });
    expect(u.oidcSub).toBe('sub-123');
    expect(u.oidcProvider).toBe(ISSUER);
  });

  test('toPublicJSON leakt die Identitätsbindung NICHT (oidcSub/Provider raus)', () => {
    const u = new User({ email: 'a@b.de', oidcSub: 'sub-123', oidcProvider: ISSUER });
    const pub = u.toPublicJSON();
    expect(pub.oidcSub).toBeUndefined();
    expect(pub.oidcProvider).toBeUndefined();
    expect(pub.passwordHash).toBeUndefined();
  });
});

describe('InMemoryUserRepository.findByOidcIdentity', () => {
  test('findet den verknüpften User über (provider, sub)', async () => {
    const repo = new InMemoryUserRepository();
    const user = new User({ email: 'linked@soc.test', oidcSub: 'sub-abc', oidcProvider: ISSUER });
    await repo.save(user);

    const found = await repo.findByOidcIdentity(ISSUER, 'sub-abc');
    expect(found).not.toBeNull();
    expect(found.id).toBe(user.id);
    expect(found.email).toBe('linked@soc.test');
  });

  test('gibt null bei unbekannter Identität', async () => {
    const repo = new InMemoryUserRepository();
    await repo.save(new User({ email: 'x@soc.test', oidcSub: 'sub-abc', oidcProvider: ISSUER }));
    expect(await repo.findByOidcIdentity(ISSUER, 'other-sub')).toBeNull();
    expect(await repo.findByOidcIdentity('https://other-idp', 'sub-abc')).toBeNull();
  });

  test('matcht NIE ungelinkte User (oidcSub=null darf nicht über null/leer treffen)', async () => {
    const repo = new InMemoryUserRepository();
    await repo.save(new User({ email: 'pw-only@soc.test' })); // kein OIDC-Link
    expect(await repo.findByOidcIdentity(ISSUER, '')).toBeNull();
    expect(await repo.findByOidcIdentity(ISSUER, null)).toBeNull();
    expect(await repo.findByOidcIdentity('', '')).toBeNull();
  });

  test('updateProfile fasst oidcSub/oidcProvider nicht an', async () => {
    const repo = new InMemoryUserRepository();
    const user = new User({ email: 'linked@soc.test', oidcSub: 'sub-abc', oidcProvider: ISSUER });
    await repo.save(user);
    await repo.updateProfile(user.id, { displayName: 'Neu' });
    const found = await repo.findById(user.id);
    expect(found.oidcSub).toBe('sub-abc');
    expect(found.oidcProvider).toBe(ISSUER);
  });
});

describe('PostgresUserRepository — OIDC-Mapping', () => {
  const repo = new PostgresUserRepository();
  const d = (iso) => (iso ? new Date(iso) : null);

  it('_rowToUser mappt oidc_sub/oidc_provider', () => {
    const u = new User({ email: 'a@b.de', passwordHash: 'h', oidcSub: 'sub-9', oidcProvider: ISSUER });
    const row = {
      id: u.id, email: u.email, display_name: '', password_hash: 'h', role: 'viewer',
      is_active: true, last_login_at: null, created_at: d(u.createdAt), updated_at: d(u.updatedAt),
      oidc_sub: 'sub-9', oidc_provider: ISSUER,
    };
    const mapped = repo._rowToUser(row);
    expect(mapped.oidcSub).toBe('sub-9');
    expect(mapped.oidcProvider).toBe(ISSUER);
  });

  it('_rowToUser: fehlende oidc-Spalten → null (keine undefined-Lecks)', () => {
    const u = new User({ email: 'a@b.de', passwordHash: 'h' });
    const row = {
      id: u.id, email: u.email, display_name: '', password_hash: 'h', role: 'viewer',
      is_active: true, last_login_at: null, created_at: d(u.createdAt), updated_at: d(u.updatedAt),
    };
    const mapped = repo._rowToUser(row);
    expect(mapped.oidcSub).toBeNull();
    expect(mapped.oidcProvider).toBeNull();
  });

  it('Vertrag: findByOidcIdentity existiert (Parität zu InMemory)', () => {
    expect(typeof repo.findByOidcIdentity).toBe('function');
  });
});
