'use strict';

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');

function makeAuth() {
  return new AuthService(new InMemoryUserRepository());
}

describe('AuthService.ensureAdminUser', () => {
  it('legt Admin an, wenn noch keiner existiert', async () => {
    const auth = makeAuth();
    const res = await auth.ensureAdminUser({ email: 'admin@firma.de', password: 'StrongPass123!' });
    expect(res.created).toBe(true);
    expect(res.email).toBe('admin@firma.de');
  });

  it('ist idempotent — zweiter Aufruf legt nichts Neues an', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.ensureAdminUser({ email: 'admin@firma.de', password: 'StrongPass123!' });
    const second = await auth.ensureAdminUser({ email: 'admin@firma.de', password: 'OtherPass456!' });
    expect(second.created).toBe(false);
    expect(repo.size()).toBe(1);
  });

  it('angelegter Admin kann sich einloggen (role=admin)', async () => {
    const repo = new InMemoryUserRepository();
    const auth = new AuthService(repo);
    await auth.ensureAdminUser({ email: 'admin@firma.de', password: 'StrongPass123!' });

    // "Restart" — neue Instanz, geteiltes Repo
    const auth2 = new AuthService(repo);
    const result = await auth2.login({ email: 'admin@firma.de', password: 'StrongPass123!' });
    expect(result.token).toBeTruthy();
    expect(result.user.role).toBe('admin');
    expect(result.user.passwordHash).toBeUndefined();
  });

  it('wirft bei zu kurzem Passwort (Validierung greift)', async () => {
    const auth = makeAuth();
    await expect(auth.ensureAdminUser({ email: 'admin@firma.de', password: 'short' }))
      .rejects.toThrow(/mindestens 8 Zeichen/);
  });

  it('wirft ohne email/password', async () => {
    const auth = makeAuth();
    await expect(auth.ensureAdminUser({ email: '', password: '' }))
      .rejects.toThrow(/ADMIN_EMAIL und ADMIN_PASSWORD/);
  });
});
