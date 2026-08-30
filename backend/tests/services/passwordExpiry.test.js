'use strict';

// Passwort-Ablauf (Welle 2): isPasswordExpired-Logik + passwordExpired-Flag
// an login und getUserById. Loader gemockt für deterministische Policy.

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { isPasswordExpired } = require('../../src/domain/passwordPolicy');

jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPlatformLanguage: jest.fn(),
  loadPasswordPolicy: jest.fn(),
  loadSessionMaxHours: jest.fn(),
  loadLockoutPolicy: jest.fn(),
  loadPasswordAgingPolicy: jest.fn(),
  loadMaxConcurrentSessions: jest.fn(),
}));

const { loadPasswordPolicy, loadSessionMaxHours, loadLockoutPolicy, loadPasswordAgingPolicy, loadMaxConcurrentSessions } =
  require('../../src/domain/passwordPolicyLoader');

const EMAIL = 'exp@test.de';
const PW    = 'Test1234';

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function makeSvc() {
  return new AuthService(new InMemoryUserRepository(), null);
}

async function makeUserWithPwAge(svc, isoChangedAt) {
  const u = await svc.register({ email: EMAIL, password: PW, displayName: 'E' });
  const stored = await svc._users.findById(u.id);
  stored.passwordChangedAt = isoChangedAt;
  await svc._users.save(stored);
  return u.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'medium' });
  loadSessionMaxHours.mockResolvedValue(8);
  loadLockoutPolicy.mockResolvedValue({ maxAttempts: 0, minutes: 15 });
  loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 0, historyCount: 0 });
  loadMaxConcurrentSessions.mockResolvedValue(0);
});

describe('isPasswordExpired (rein)', () => {
  it('deaktiviert (0) → nie abgelaufen', () => {
    expect(isPasswordExpired(daysAgo(999), 0)).toBe(false);
  });
  it('frisches Passwort → nicht abgelaufen', () => {
    expect(isPasswordExpired(daysAgo(10), 90)).toBe(false);
  });
  it('altes Passwort → abgelaufen', () => {
    expect(isPasswordExpired(daysAgo(120), 90)).toBe(true);
  });
  it('unbekanntes Datum bei aktiver Policy → abgelaufen (einmaliger Zwangswechsel)', () => {
    expect(isPasswordExpired(null, 90)).toBe(true);
    expect(isPasswordExpired('kaputt', 90)).toBe(true);
  });
});

describe('AuthService.login — passwordExpired-Flag', () => {
  it('altes Passwort + Ablauf 90 → passwordExpired true', async () => {
    loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 90, historyCount: 0 });
    const svc = makeSvc();
    await makeUserWithPwAge(svc, daysAgo(120));
    const res = await svc.login({ email: EMAIL, password: PW });
    expect(res.user.passwordExpired).toBe(true);
  });

  it('frisches Passwort + Ablauf 90 → passwordExpired false', async () => {
    loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 90, historyCount: 0 });
    const svc = makeSvc();
    await makeUserWithPwAge(svc, daysAgo(5));
    const res = await svc.login({ email: EMAIL, password: PW });
    expect(res.user.passwordExpired).toBe(false);
  });

  it('Ablauf deaktiviert → passwordExpired false trotz altem Passwort', async () => {
    const svc = makeSvc();
    await makeUserWithPwAge(svc, daysAgo(999));
    const res = await svc.login({ email: EMAIL, password: PW });
    expect(res.user.passwordExpired).toBe(false);
  });
});

describe('AuthService.getUserById — passwordExpired-Flag (für /me)', () => {
  it('liefert passwordExpired true bei altem Passwort + aktiver Policy', async () => {
    loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 30, historyCount: 0 });
    const svc = makeSvc();
    const id  = await makeUserWithPwAge(svc, daysAgo(60));
    const me  = await svc.getUserById(id);
    expect(me.passwordExpired).toBe(true);
    expect(me.passwordHash).toBeUndefined();
  });
});
