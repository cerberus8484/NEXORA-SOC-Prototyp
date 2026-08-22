'use strict';

// Deployment Center — Phase 4: deploy_reauth (frische Re-Auth vor Infra-Write).

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');

jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPasswordPolicy: jest.fn().mockResolvedValue({ minLength: 8, complexity: 'medium' }),
  loadSessionMaxHours: jest.fn().mockResolvedValue(8),
  loadLockoutPolicy: jest.fn().mockResolvedValue({ maxAttempts: 0, minutes: 15 }),
  loadPasswordAgingPolicy: jest.fn().mockResolvedValue({ expiryDays: 0, historyCount: 0 }),
  loadMaxConcurrentSessions: jest.fn().mockResolvedValue(0),
}));

const EMAIL = 'deployer@test.de';
const PASSWORD = 'Deploy1234';

async function setup() {
  const svc = new AuthService(new InMemoryUserRepository(), null);
  const user = await svc.register({ email: EMAIL, password: PASSWORD, displayName: 'D' });
  return { svc, userId: user.user ? user.user.id : user.id };
}

describe('AuthService — deploy_reauth', () => {
  test('issueDeployReauth gibt bei korrektem Passwort einen Token', async () => {
    const { svc } = await setup();
    const { token, expiresIn } = await svc.issueDeployReauth({ email: EMAIL, password: PASSWORD });
    expect(token).toBeTruthy();
    expect(expiresIn).toBeGreaterThan(0);
  });

  test('issueDeployReauth wirft bei falschem Passwort', async () => {
    const { svc } = await setup();
    await expect(svc.issueDeployReauth({ email: EMAIL, password: 'nope' })).rejects.toThrow(/Re-Authentifizierung/);
  });

  test('verifyDeployReauth akzeptiert nur den richtigen Zweck + Actor', async () => {
    const { svc, userId } = await setup();
    const { token } = await svc.issueDeployReauth({ email: EMAIL, password: PASSWORD });
    expect(await svc.verifyDeployReauth(token, 'anderer-user')).toMatchObject({ ok: false });
    expect(await svc.verifyDeployReauth('', userId)).toMatchObject({ ok: false });
    expect(await svc.verifyDeployReauth(token, userId)).toMatchObject({ ok: true, sub: userId });
  });

  test('One-Shot: ein deploy_reauth-Token ist nur EINMAL gültig (Replay-Schutz)', async () => {
    const { svc, userId } = await setup();
    const { token } = await svc.issueDeployReauth({ email: EMAIL, password: PASSWORD });
    expect(await svc.verifyDeployReauth(token, userId)).toMatchObject({ ok: true });
    // zweite Verwendung desselben Tokens → invalidiert
    expect(await svc.verifyDeployReauth(token, userId)).toMatchObject({ ok: false });
  });

  test('ein apply_reauth-Token ist NICHT als deploy_reauth gültig (Zweck-Trennung)', async () => {
    const { svc, userId } = await setup();
    const { token } = await svc.issueApplyReauth({ email: EMAIL, password: PASSWORD });
    expect(await svc.verifyDeployReauth(token, userId)).toMatchObject({ ok: false });
  });

  test('ein deploy_reauth-Token ist kein Session-Token (verifyToken lehnt ab)', async () => {
    const { svc, userId } = await setup();
    const { token } = await svc.issueDeployReauth({ email: EMAIL, password: PASSWORD });
    await expect(svc.verifyToken(token)).rejects.toThrow();
  });
});
