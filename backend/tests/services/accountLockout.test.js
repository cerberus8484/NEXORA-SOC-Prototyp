'use strict';

// Account-Lockout in AuthService.login.
// Default (maxAttempts 0) = deaktiviert → kein Verhaltenswechsel.
// Aktiviert (maxAttempts > 0) → nach N Fehlversuchen wird das Konto gesperrt.
//
// Der Settings-Loader wird gemockt, damit Lockout-Policy deterministisch
// und ohne KV-Store-/Timing-Kopplung gesetzt werden kann.

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { UnauthorizedError } = require('../../src/errors/AppError');

jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPlatformLanguage: jest.fn(),
  loadPasswordPolicy: jest.fn().mockResolvedValue({ minLength: 8, complexity: 'medium' }),
  loadSessionMaxHours: jest.fn().mockResolvedValue(8),
  loadLockoutPolicy: jest.fn(),
  loadPasswordAgingPolicy: jest.fn().mockResolvedValue({ expiryDays: 0, historyCount: 0 }),
  loadMaxConcurrentSessions: jest.fn().mockResolvedValue(0),
}));

const { loadLockoutPolicy } = require('../../src/domain/passwordPolicyLoader');

const EMAIL = 'lock@test.de';
const PASSWORD = 'Test1234';

function makeAuthService() {
  return new AuthService(new InMemoryUserRepository(), null);
}

async function makeUser(svc) {
  await svc.register({ email: EMAIL, password: PASSWORD, displayName: 'L' });
}

const wrong = (svc) => svc.login({ email: EMAIL, password: 'WrongPass1' });
const right = (svc) => svc.login({ email: EMAIL, password: PASSWORD });

beforeEach(() => {
  jest.clearAllMocks();
  loadLockoutPolicy.mockResolvedValue({ maxAttempts: 0, minutes: 15 });
});

describe('AuthService.login — Account-Lockout deaktiviert (Default)', () => {
  test('viele Fehlversuche bleiben "Ungültige Credentials" — keine Sperre', async () => {
    const svc = makeAuthService();
    await makeUser(svc);

    for (let i = 0; i < 10; i++) {
      await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    }
    // Korrektes Passwort funktioniert weiterhin.
    await expect(right(svc)).resolves.toHaveProperty('token');
  });
});

describe('AuthService.login — Account-Lockout aktiviert (maxAttempts 3)', () => {
  beforeEach(() => {
    loadLockoutPolicy.mockResolvedValue({ maxAttempts: 3, minutes: 15 });
  });

  test('3 Fehlversuche → 4. Versuch ist gesperrt (auch mit korrektem Passwort)', async () => {
    const svc = makeAuthService();
    await makeUser(svc);

    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');

    // Konto jetzt gesperrt — sogar das korrekte Passwort wird abgelehnt.
    await expect(right(svc)).rejects.toThrow(/gesperrt/i);
  });

  test('erfolgreicher Login setzt den Fehlversuch-Zähler zurück', async () => {
    const svc = makeAuthService();
    await makeUser(svc);

    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    // Vor dem Sperren korrekt einloggen → Zähler zurück.
    await expect(right(svc)).resolves.toHaveProperty('token');

    // Zwei weitere Fehlversuche dürfen noch nicht sperren (Zähler war zurückgesetzt).
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(right(svc)).resolves.toHaveProperty('token');
  });

  test('abgelaufene Sperre erlaubt erneuten Login', async () => {
    const svc = makeAuthService();
    await makeUser(svc);

    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(wrong(svc)).rejects.toThrow('Ungültige Credentials');
    await expect(right(svc)).rejects.toThrow(/gesperrt/i);

    // Sperre künstlich in die Vergangenheit setzen (Ablauf simulieren).
    const entry = svc._loginAttempts.get(EMAIL);
    entry.lockedUntil = Date.now() - 1000;

    await expect(right(svc)).resolves.toHaveProperty('token');
  });

  test('gesperrtes Konto wirft UnauthorizedError', async () => {
    const svc = makeAuthService();
    await makeUser(svc);
    for (let i = 0; i < 3; i++) {
      await wrong(svc).catch(() => {});
    }
    await expect(right(svc)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// ── DB-Pfad: Lockout persistiert in login_lockouts ───────────────────────────
// Fake-queryFn simuliert die Postgres-Tabelle, geteilt über zwei AuthService-
// Instanzen → beweist Restart-/Multi-Instanz-Festigkeit.

function makeFakeDb() {
  const rows = new Map(); // email -> { fails, locked_until: Date|null }
  return async function queryFn(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('CREATE TABLE')) return { rows: [] };
    if (s.startsWith('UPDATE login_lockouts SET locked_until = NULL')) {
      for (const v of rows.values()) {
        if (v.locked_until && v.locked_until.getTime() < Date.now()) { v.locked_until = null; v.fails = 0; }
      }
      return { rows: [] };
    }
    if (s.startsWith('SELECT locked_until FROM login_lockouts')) {
      const v = rows.get(params[0]);
      return { rows: v ? [{ locked_until: v.locked_until }] : [] };
    }
    if (s.startsWith('INSERT INTO login_lockouts')) {
      const v = rows.get(params[0]) || { fails: 0, locked_until: null };
      v.fails += 1;
      rows.set(params[0], v);
      return { rows: [{ fails: v.fails }] };
    }
    if (s.startsWith('UPDATE login_lockouts SET locked_until = $2')) {
      const v = rows.get(params[0]) || { fails: 0, locked_until: null };
      v.locked_until = new Date(params[1]);
      v.fails = 0;
      rows.set(params[0], v);
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM login_lockouts')) {
      rows.delete(params[0]);
      return { rows: [] };
    }
    return { rows: [] };
  };
}

describe('AuthService.login — Lockout DB-Pfad (persistent)', () => {
  beforeEach(() => {
    loadLockoutPolicy.mockResolvedValue({ maxAttempts: 3, minutes: 15 });
  });

  test('Sperre überlebt einen "Neustart" (neue Instanz, geteilte DB)', async () => {
    const db   = makeFakeDb();
    const repo = new InMemoryUserRepository();

    const svc1 = new AuthService(repo, db);
    await svc1.register({ email: EMAIL, password: PASSWORD, displayName: 'L' });
    await expect(svc1.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');
    await expect(svc1.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');
    await expect(svc1.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');

    // "Restart": frische Instanz, dieselbe DB → Sperre muss erhalten sein.
    const svc2 = new AuthService(repo, db);
    await expect(svc2.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(/gesperrt/i);
  });

  test('erfolgreicher Login löscht den DB-Lockout-Eintrag', async () => {
    const db   = makeFakeDb();
    const repo = new InMemoryUserRepository();
    const svc  = new AuthService(repo, db);
    await svc.register({ email: EMAIL, password: PASSWORD, displayName: 'L' });

    await expect(svc.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');
    await expect(svc.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');
    // Vor der Sperre korrekt einloggen → Zähler in DB zurück.
    await expect(svc.login({ email: EMAIL, password: PASSWORD })).resolves.toHaveProperty('token');
    // Zwei weitere Fehlversuche dürfen noch nicht sperren.
    await expect(svc.login({ email: EMAIL, password: 'WrongPass1' })).rejects.toThrow('Ungültige Credentials');
    await expect(svc.login({ email: EMAIL, password: PASSWORD })).resolves.toHaveProperty('token');
  });
});
