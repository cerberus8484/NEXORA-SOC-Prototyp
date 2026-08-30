'use strict';

// Erst-Login-Passwortzwang (Easy-Install): der Bootstrap-Admin muss sein
// temporäres Passwort beim ersten Login wechseln. Eigenes Flag, getrennt vom Ablauf.

const { User } = require('../../src/domain/User');
const { authService } = require('../../src/services/AuthService');

beforeEach(() => {
  authService._users.clear();
  if (authService._blocklist && authService._blocklist.clear) authService._blocklist.clear();
});

describe('User-Domain: mustChangePassword', () => {
  test('Default false und in toPublicJSON enthalten (ohne Hash)', () => {
    const u = new User({ email: 'x@y.z', passwordHash: 'geheim' });
    expect(u.mustChangePassword).toBe(false);
    const pub = u.toPublicJSON();
    expect(pub.mustChangePassword).toBe(false);
    expect(pub.passwordHash).toBeUndefined();
  });

  test('true wird übernommen', () => {
    const u = new User({ mustChangePassword: true });
    expect(u.toPublicJSON().mustChangePassword).toBe(true);
  });
});

describe('AuthService: Erst-Login-Zwang', () => {
  test('ensureAdminUser legt Admin mit mustChangePassword=true an', async () => {
    const r = await authService.ensureAdminUser({ email: 'admin@test.soc', password: 'Test1234!' });
    expect(r.created).toBe(true);
    const login = await authService.login({ email: 'admin@test.soc', password: 'Test1234!' });
    expect(login.user.mustChangePassword).toBe(true);
    expect(login.user.passwordHash).toBeUndefined();
  });

  test('changePassword löscht mustChangePassword (Gate verschwindet)', async () => {
    await authService.ensureAdminUser({ email: 'a2@test.soc', password: 'Test1234!' });
    const login = await authService.login({ email: 'a2@test.soc', password: 'Test1234!' });
    await authService.changePassword({
      userId: login.user.id, currentPassword: 'Test1234!', newPassword: 'Test9999!',
    });
    const login2 = await authService.login({ email: 'a2@test.soc', password: 'Test9999!' });
    expect(login2.user.mustChangePassword).toBe(false);
  });

  test('normal registrierter User: mustChangePassword=false', async () => {
    const u = await authService.register({
      email: 'u@test.soc', password: 'Test1234!', displayName: 'U', role: 'analyst',
    });
    expect(u.mustChangePassword).toBe(false);
  });
});
