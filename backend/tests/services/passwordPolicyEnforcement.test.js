'use strict';

// TDD RED-Phase: Policy-Durchsetzung in AuthService + UserService
// Testet register, changePassword, users-create, resetPassword gegen die Policy.
// Alle Tests mocken den Settings-KV-Store über das settingsLoader-Modul.

const { AuthService } = require('../../src/services/AuthService');
const { UserService }  = require('../../src/services/UserService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { ValidationError } = require('../../src/errors/AppError');

// settingsLoader ist der gemeinsame Helper, der Policy aus dem KV-Store liest.
// Wir mocken ihn hier direkt für isolierte Unit-Tests.
jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPasswordPolicy: jest.fn(),
  loadSessionMaxHours: jest.fn(),
  loadLockoutPolicy: jest.fn(),
  loadPasswordAgingPolicy: jest.fn(),
  loadMaxConcurrentSessions: jest.fn(),
}));

const { loadPasswordPolicy, loadSessionMaxHours, loadLockoutPolicy, loadPasswordAgingPolicy, loadMaxConcurrentSessions } = require('../../src/domain/passwordPolicyLoader');

function makeAuthService() {
  return new AuthService(new InMemoryUserRepository(), null);
}

function makeUserService(authSvc) {
  return new UserService(authSvc._users);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: Policy wie frisch installiert (medium, minLength 8)
  loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
  loadSessionMaxHours.mockResolvedValue(8);
  // Account-Lockout standardmäßig deaktiviert (maxAttempts 0).
  loadLockoutPolicy.mockResolvedValue({ maxAttempts: 0, minutes: 15 });
  // Passwort-Aging standardmäßig deaktiviert.
  loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 0, historyCount: 0 });
  // Concurrent-Session-Limit standardmäßig unbegrenzt.
  loadMaxConcurrentSessions.mockResolvedValue(0);
});

// ── register ──────────────────────────────────────────────────────────────────

describe('AuthService.register — Policy-Durchsetzung', () => {
  test('zu kurzes Passwort (< 8) → ValidationError', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    const svc = makeAuthService();
    await expect(
      svc.register({ email: 'a@test.de', password: 'kurz', displayName: 'A' })
    ).rejects.toThrow(ValidationError);
  });

  test('Passwort erfüllt medium (Buchstabe+Ziffer) → ok', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    const svc = makeAuthService();
    const user = await svc.register({ email: 'b@test.de', password: 'Test1234', displayName: 'B' });
    expect(user.email).toBe('b@test.de');
  });

  test('Policy auf high — fehlt Sonderzeichen → ValidationError', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    await expect(
      svc.register({ email: 'c@test.de', password: 'TestPass1', displayName: 'C' })
    ).rejects.toThrow(ValidationError);
  });

  test('Policy auf high — vollständiges PW → ok', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    const user = await svc.register({ email: 'd@test.de', password: 'TestPass1!', displayName: 'D' });
    expect(user.email).toBe('d@test.de');
  });

  test('Policy minLength=12 — 11-Zeichen-PW → ValidationError', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 12, complexity: 'medium' });
    const svc = makeAuthService();
    await expect(
      svc.register({ email: 'e@test.de', password: 'TestPass123', displayName: 'E' }) // 11 Zeichen
    ).rejects.toThrow(ValidationError);
  });

  test('Policy minLength=12 — 12-Zeichen-PW medium → ok', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 12, complexity: 'medium' });
    const svc = makeAuthService();
    const user = await svc.register({ email: 'f@test.de', password: 'TestPass1234', displayName: 'F' });
    expect(user.email).toBe('f@test.de');
  });

  test('ValidationError enthält Fehler-Details (errors array)', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    try {
      await svc.register({ email: 'g@test.de', password: 'weak', displayName: 'G' });
      fail('sollte nicht erreicht werden');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toBeTruthy();
    }
  });
});

// ── changePassword ────────────────────────────────────────────────────────────

describe('AuthService.changePassword — Policy-Durchsetzung', () => {
  async function makeUserWithLogin(svc, pw = 'CurrentPass1!') {
    await svc.register({ email: 'user@test.de', password: pw, displayName: 'U', role: 'analyst' });
    const user = await svc._users.findByEmail('user@test.de');
    return user.id;
  }

  test('neues Passwort verletzt Policy → ValidationError', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    // Erst mit high registrieren
    const userId = await makeUserWithLogin(svc, 'CurrentPass1!');

    // Dann auf schwaches PW wechseln wollen
    await expect(
      svc.changePassword({ userId, currentPassword: 'CurrentPass1!', newPassword: 'weak' })
    ).rejects.toThrow(ValidationError);
  });

  test('neues Passwort erfüllt Policy → ok', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    const userId = await makeUserWithLogin(svc, 'CurrentPass1!');

    const result = await svc.changePassword({
      userId,
      currentPassword: 'CurrentPass1!',
      newPassword: 'NewStrongPass1!',
    });
    expect(result.ok).toBe(true);
  });

  test('Policy medium — Passwort ohne Ziffer → ValidationError', async () => {
    // Für Register mock temporär auf low setzen damit der User erstellt werden kann
    loadPasswordPolicy.mockResolvedValueOnce({ minLength: 8, complexity: 'low' });
    const svc = makeAuthService();
    const userId = await makeUserWithLogin(svc, 'onlyletter');

    // Neues PW: nur Buchstaben, keine Ziffer → verletzt medium
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    await expect(
      svc.changePassword({ userId, currentPassword: 'onlyletter', newPassword: 'onlyletters' })
    ).rejects.toThrow(ValidationError);
  });

  test('Policy medium — nur-Ziffern-PW → ValidationError (fehlt Buchstabe)', async () => {
    loadPasswordPolicy.mockResolvedValueOnce({ minLength: 8, complexity: 'low' });
    const svc = makeAuthService();
    const userId = await makeUserWithLogin(svc, 'onlyletter');

    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    await expect(
      svc.changePassword({ userId, currentPassword: 'onlyletter', newPassword: '12345678' })
    ).rejects.toThrow(ValidationError);
  });
});

// ── UserService.resetPassword ─────────────────────────────────────────────────

describe('UserService.resetPassword — Temp-PW erfüllt Policy', () => {
  test('resetPassword erzeugt Temp-PW, das medium besteht', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    const svc = makeAuthService();
    await svc.register({ email: 'r@test.de', password: 'StartPass1', displayName: 'R' });
    const user = await svc._users.findByEmail('r@test.de');
    const userSvc = makeUserService(svc);

    const { tempPassword } = await userSvc.resetPassword(user.id);

    // Temp-PW muss die aktuelle Policy bestehen
    const { validatePassword } = require('../../src/domain/passwordPolicy');
    const check = validatePassword(tempPassword, { minLength: 8, complexity: 'medium' });
    expect(check.ok).toBe(true);
  });

  test('resetPassword erzeugt Temp-PW, das high besteht', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'high' });
    const svc = makeAuthService();
    // Register mit high-Policy-kompatiblem PW
    await svc.register({ email: 'rh@test.de', password: 'StartPass1!', displayName: 'RH' });
    const user = await svc._users.findByEmail('rh@test.de');
    const userSvc = makeUserService(svc);

    const { tempPassword } = await userSvc.resetPassword(user.id);

    const { validatePassword } = require('../../src/domain/passwordPolicy');
    const check = validatePassword(tempPassword, { minLength: 8, complexity: 'high' });
    expect(check.ok).toBe(true);
  });

  test('resetPassword gibt tempPassword ≥ 16 Zeichen zurück', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    const svc = makeAuthService();
    await svc.register({ email: 'rl@test.de', password: 'StartPass1', displayName: 'RL' });
    const user = await svc._users.findByEmail('rl@test.de');
    const userSvc = makeUserService(svc);

    const { tempPassword } = await userSvc.resetPassword(user.id);
    expect(tempPassword.length).toBeGreaterThanOrEqual(16);
  });
});

// ── sessionMaxHours → JWT exp ─────────────────────────────────────────────────

describe('AuthService.login — sessionMaxHours steuert JWT exp', () => {
  test('sessionMaxHours=1 → Token exp ist ~1h in der Zukunft', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    loadSessionMaxHours.mockResolvedValue(1);

    const svc = makeAuthService();
    await svc.register({ email: 'session@test.de', password: 'Test1234', displayName: 'S' });

    const before = Math.floor(Date.now() / 1000);
    const { token } = await svc.login({ email: 'session@test.de', password: 'Test1234' });

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../src/services/AuthService');
    const payload = jwt.verify(token, JWT_SECRET);

    const after = Math.floor(Date.now() / 1000);
    // exp sollte ca. 3600 Sekunden nach dem Login liegen
    expect(payload.exp).toBeGreaterThan(before + 3500);
    expect(payload.exp).toBeLessThan(after + 3700);
  });

  test('sessionMaxHours=24 → Token exp ist ~24h in der Zukunft', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    loadSessionMaxHours.mockResolvedValue(24);

    const svc = makeAuthService();
    await svc.register({ email: 'session24@test.de', password: 'Test1234', displayName: 'S24' });

    const before = Math.floor(Date.now() / 1000);
    const { token } = await svc.login({ email: 'session24@test.de', password: 'Test1234' });

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../src/services/AuthService');
    const payload = jwt.verify(token, JWT_SECRET);
    const after = Math.floor(Date.now() / 1000);

    expect(payload.exp).toBeGreaterThan(before + 24 * 3600 - 60);
    expect(payload.exp).toBeLessThan(after + 24 * 3600 + 60);
  });

  test('kein sessionMaxHours im Store → Fallback auf JWT_EXPIRES_IN / 8h', async () => {
    loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
    loadSessionMaxHours.mockResolvedValue(null); // kein Wert → Fallback

    const svc = makeAuthService();
    await svc.register({ email: 'sessionfb@test.de', password: 'Test1234', displayName: 'SFB' });

    const before = Math.floor(Date.now() / 1000);
    const { token } = await svc.login({ email: 'sessionfb@test.de', password: 'Test1234' });

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../src/services/AuthService');
    const payload = jwt.verify(token, JWT_SECRET);
    const after = Math.floor(Date.now() / 1000);

    // Fallback = 8h
    expect(payload.exp).toBeGreaterThan(before + 8 * 3600 - 60);
    expect(payload.exp).toBeLessThan(after + 8 * 3600 + 60);
  });
});
