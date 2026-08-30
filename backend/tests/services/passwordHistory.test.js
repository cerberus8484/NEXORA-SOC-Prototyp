'use strict';

// Passwort-History (Welle 2): Wiederverwendungssperre in AuthService.changePassword
// + reine pushPasswordHistory-Logik. Loader gemockt für deterministische Policy.

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { ValidationError } = require('../../src/errors/AppError');
const { pushPasswordHistory } = require('../../src/domain/passwordPolicy');

jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPlatformLanguage: jest.fn(),
  loadPasswordPolicy: jest.fn(),
  loadSessionMaxHours: jest.fn(),
  loadLockoutPolicy: jest.fn(),
  loadPasswordAgingPolicy: jest.fn(),
}));

const { loadPasswordPolicy, loadPasswordAgingPolicy } = require('../../src/domain/passwordPolicyLoader');

const EMAIL = 'hist@test.de';

function makeSvc() {
  return new AuthService(new InMemoryUserRepository(), null);
}

async function makeUser(svc, pw) {
  const u = await svc.register({ email: EMAIL, password: pw, displayName: 'H' });
  return u.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  loadPasswordPolicy.mockResolvedValue({ minLength: 8, complexity: 'low' });
  loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 0, historyCount: 0 });
});

describe('pushPasswordHistory (rein)', () => {
  it('count 0 → leeres Array (deaktiviert)', () => {
    expect(pushPasswordHistory(['x'], 'h', 0)).toEqual([]);
  });
  it('reiht neuesten Hash vorne ein und trimmt auf count', () => {
    expect(pushPasswordHistory(['b', 'c'], 'a', 2)).toEqual(['a', 'b']);
  });
  it('verträgt nicht-Array-History', () => {
    expect(pushPasswordHistory(undefined, 'a', 3)).toEqual(['a']);
  });
});

describe('AuthService.changePassword — History deaktiviert (count 0)', () => {
  it('erlaubt Wiederverwendung eines alten Passworts', async () => {
    const svc = makeSvc();
    const id  = await makeUser(svc, 'PassOne11');
    await svc.changePassword({ userId: id, currentPassword: 'PassOne11', newPassword: 'PassTwo22' });
    // zurück auf das alte Passwort — bei count 0 erlaubt
    const r = await svc.changePassword({ userId: id, currentPassword: 'PassTwo22', newPassword: 'PassOne11' });
    expect(r.ok).toBe(true);
  });
});

describe('AuthService.changePassword — History aktiv (count 2)', () => {
  beforeEach(() => {
    loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 0, historyCount: 2 });
  });

  it('lehnt Wiederverwendung eines Passworts aus der History ab', async () => {
    const svc = makeSvc();
    const id  = await makeUser(svc, 'PassOne11');
    await svc.changePassword({ userId: id, currentPassword: 'PassOne11', newPassword: 'PassTwo22' });
    // PassOne11 liegt jetzt in der History → Wiederverwendung verboten
    await expect(
      svc.changePassword({ userId: id, currentPassword: 'PassTwo22', newPassword: 'PassOne11' }),
    ).rejects.toThrow(ValidationError);
  });

  it('erlaubt ein Passwort wieder, sobald es aus dem History-Fenster gefallen ist', async () => {
    const svc = makeSvc();
    const id  = await makeUser(svc, 'PassOne11');
    await svc.changePassword({ userId: id, currentPassword: 'PassOne11',   newPassword: 'PassTwo22'   });
    await svc.changePassword({ userId: id, currentPassword: 'PassTwo22',   newPassword: 'PassThree33' });
    await svc.changePassword({ userId: id, currentPassword: 'PassThree33', newPassword: 'PassFour44'  });
    // History (count 2) enthält jetzt [PassThree33, PassTwo22]; PassOne11 ist raus → wieder erlaubt
    const r = await svc.changePassword({ userId: id, currentPassword: 'PassFour44', newPassword: 'PassOne11' });
    expect(r.ok).toBe(true);
  });

  it('setzt passwordChangedAt bei Änderung', async () => {
    const svc = makeSvc();
    const id  = await makeUser(svc, 'PassOne11');
    await svc.changePassword({ userId: id, currentPassword: 'PassOne11', newPassword: 'PassTwo22' });
    const user = await svc._users.findById(id);
    expect(user.passwordChangedAt).toBeTruthy();
  });
});

describe('User.toPublicJSON — History wird nie exponiert', () => {
  it('enthält weder passwordHash noch passwordHistory', async () => {
    loadPasswordAgingPolicy.mockResolvedValue({ expiryDays: 0, historyCount: 3 });
    const svc = makeSvc();
    const id  = await makeUser(svc, 'PassOne11');
    await svc.changePassword({ userId: id, currentPassword: 'PassOne11', newPassword: 'PassTwo22' });
    const pub = (await svc._users.findById(id)).toPublicJSON();
    expect(pub.passwordHash).toBeUndefined();
    expect(pub.passwordHistory).toBeUndefined();
  });
});
