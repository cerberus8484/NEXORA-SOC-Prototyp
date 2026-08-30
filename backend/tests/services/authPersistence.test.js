'use strict';

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');

describe('InMemoryUserRepository', () => {
  it('save + findByEmail (case-insensitiv) + findById', async () => {
    const repo = new InMemoryUserRepository();
    const { User } = require('../../src/domain/User');
    const u = new User({ email: 'Test@Firma.DE', passwordHash: 'h', role: 'analyst' });
    await repo.save(u);
    expect((await repo.findByEmail('test@firma.de')).id).toBe(u.id);
    expect((await repo.findById(u.id)).email).toBe('test@firma.de');
    expect(await repo.findByEmail('unknown@firma.de')).toBeNull();
  });
});

describe('AuthService — Persistenz über das Repository', () => {
  it('register() speichert tatsächlich im Repository (P14 Bug-Fix)', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.register({ email: 'a@firma.de', password: 'Test1234!', role: 'analyst' });
    expect(repo.size()).toBe(1);
    expect((await repo.findByEmail('a@firma.de'))).not.toBeNull();
  });

  it('Login funktioniert nach "Restart" (neue AuthService-Instanz, geteiltes Repo)', async () => {
    const repo = new InMemoryUserRepository();

    // Instanz A registriert
    const authA = new AuthService(repo);
    await authA.register({ email: 'persist@firma.de', password: 'Test1234!', role: 'admin' });

    // "Restart": neue Service-Instanz, dieselbe Persistenz
    const authB = new AuthService(repo);
    const result = await authB.login({ email: 'persist@firma.de', password: 'Test1234!' });

    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe('persist@firma.de');
    expect(result.user.role).toBe('admin');
    expect(result.user.passwordHash).toBeUndefined();   // maskiert
  });

  it('Login mit falschem Passwort schlägt fehl', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.register({ email: 'b@firma.de', password: 'Test1234!' });
    await expect(auth.login({ email: 'b@firma.de', password: 'falsch' }))
      .rejects.toThrow(/Ungültige Credentials/);
  });

  it('getUserFromToken liefert nach Login den User (maskiert)', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.register({ email: 'c@firma.de', password: 'Test1234!', role: 'viewer' });
    const { token } = await auth.login({ email: 'c@firma.de', password: 'Test1234!' });
    const user = await auth.getUserFromToken(token);
    expect(user.email).toBe('c@firma.de');
    expect(user.role).toBe('viewer');
    expect(user.passwordHash).toBeUndefined();
  });

  it('setzt lastLoginAt beim erfolgreichen Login und persistiert es', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.register({ email: 'd@firma.de', password: 'Test1234!' });

    const before = await repo.findByEmail('d@firma.de');
    expect(before.lastLoginAt).toBeNull();

    const res = await auth.login({ email: 'd@firma.de', password: 'Test1234!' });
    expect(res.user.lastLoginAt).toBeTruthy();

    // im Repository gespeichert (nicht nur im Response-Objekt)
    const after = await repo.findByEmail('d@firma.de');
    expect(after.lastLoginAt).toBe(res.user.lastLoginAt);
  });

  it('fehlgeschlagener Login setzt lastLoginAt NICHT', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.register({ email: 'e@firma.de', password: 'Test1234!' });
    await expect(auth.login({ email: 'e@firma.de', password: 'falsch' })).rejects.toThrow();
    const u = await repo.findByEmail('e@firma.de');
    expect(u.lastLoginAt).toBeNull();
  });
});
