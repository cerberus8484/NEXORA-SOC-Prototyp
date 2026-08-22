'use strict';

// Concurrent-Session-Limit (Welle 2): bei Überschreiten werden die ältesten
// Sessions revoziert (Token landet in der Blocklist). Memory- und DB-Pfad.

const { AuthService } = require('../../src/services/AuthService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');

jest.mock('../../src/domain/passwordPolicyLoader', () => ({
  loadPasswordPolicy: jest.fn().mockResolvedValue({ minLength: 8, complexity: 'medium' }),
  loadSessionMaxHours: jest.fn().mockResolvedValue(8),
  loadLockoutPolicy: jest.fn().mockResolvedValue({ maxAttempts: 0, minutes: 15 }),
  loadPasswordAgingPolicy: jest.fn().mockResolvedValue({ expiryDays: 0, historyCount: 0 }),
  loadMaxConcurrentSessions: jest.fn(),
}));

const { loadMaxConcurrentSessions } = require('../../src/domain/passwordPolicyLoader');

const EMAIL = 'sess@test.de';
const PW    = 'Test1234';

async function setup(svc) {
  await svc.register({ email: EMAIL, password: PW, displayName: 'S' });
}
const doLogin = (svc) => svc.login({ email: EMAIL, password: PW });

beforeEach(() => {
  jest.clearAllMocks();
  loadMaxConcurrentSessions.mockResolvedValue(0);
});

describe('Concurrent-Session-Limit — unbegrenzt (0)', () => {
  it('alle Sessions bleiben gültig', async () => {
    const svc = new AuthService(new InMemoryUserRepository(), null);
    await setup(svc);
    const a = await doLogin(svc);
    const b = await doLogin(svc);
    const c = await doLogin(svc);
    await expect(svc.verifyToken(a.token)).resolves.toBeTruthy();
    await expect(svc.verifyToken(b.token)).resolves.toBeTruthy();
    await expect(svc.verifyToken(c.token)).resolves.toBeTruthy();
  });
});

describe('Concurrent-Session-Limit — max 2 (In-Memory)', () => {
  it('3. Login revoziert die älteste Session', async () => {
    loadMaxConcurrentSessions.mockResolvedValue(2);
    const svc = new AuthService(new InMemoryUserRepository(), null);
    await setup(svc);
    const a = await doLogin(svc);
    const b = await doLogin(svc);
    const c = await doLogin(svc);
    await expect(svc.verifyToken(a.token)).rejects.toThrow(/invalidiert/i); // ältester raus
    await expect(svc.verifyToken(b.token)).resolves.toBeTruthy();
    await expect(svc.verifyToken(c.token)).resolves.toBeTruthy();
  });

  it('Logout gibt einen Slot frei', async () => {
    loadMaxConcurrentSessions.mockResolvedValue(2);
    const svc = new AuthService(new InMemoryUserRepository(), null);
    await setup(svc);
    const a = await doLogin(svc);
    const b = await doLogin(svc);
    await svc.logout(b.jti, undefined);          // b beenden → 1 aktive Session (a)
    const c = await doLogin(svc);                // a + c = 2, kein Revoke nötig
    await expect(svc.verifyToken(a.token)).resolves.toBeTruthy();
    await expect(svc.verifyToken(c.token)).resolves.toBeTruthy();
  });
});

// ── DB-Pfad: Fake-DB für user_sessions + jwt_blocklist ───────────────────────

function makeFakeDb() {
  const sessions  = new Map(); // jti -> { user_id, expires_at: Date, seq }
  const blocklist = new Map(); // jti -> expires_at: Date
  let seq = 0;
  return async function q(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('CREATE TABLE')) return { rows: [] };

    if (s.startsWith('DELETE FROM user_sessions WHERE expires_at')) {
      for (const [j, v] of sessions) if (v.expires_at.getTime() < Date.now()) sessions.delete(j);
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO user_sessions')) {
      const [jti, userId, exp] = params;
      if (!sessions.has(jti)) sessions.set(jti, { user_id: userId, expires_at: new Date(exp), seq: seq++ });
      return { rows: [] };
    }
    if (s.startsWith('SELECT jti, expires_at FROM user_sessions')) {
      const rows = [...sessions.entries()]
        .filter(([, v]) => v.user_id === params[0] && v.expires_at.getTime() >= Date.now())
        .sort((a, b) => a[1].seq - b[1].seq)
        .map(([jti, v]) => ({ jti, expires_at: v.expires_at }));
      return { rows };
    }
    if (s.startsWith('DELETE FROM user_sessions WHERE jti')) {
      sessions.delete(params[0]); return { rows: [] };
    }

    if (s.startsWith('INSERT INTO jwt_blocklist')) {
      if (!blocklist.has(params[0])) blocklist.set(params[0], new Date(params[1]));
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM jwt_blocklist')) {
      for (const [j, e] of blocklist) if (e.getTime() < Date.now()) blocklist.delete(j);
      return { rows: [] };
    }
    if (s.startsWith('SELECT 1 FROM jwt_blocklist')) {
      const e = blocklist.get(params[0]);
      return { rows: (e && e.getTime() >= Date.now()) ? [{ ok: 1 }] : [] };
    }
    return { rows: [] };
  };
}

describe('Concurrent-Session-Limit — max 2 (DB-Pfad)', () => {
  it('3. Login revoziert die älteste Session persistent', async () => {
    loadMaxConcurrentSessions.mockResolvedValue(2);
    const db  = makeFakeDb();
    const svc = new AuthService(new InMemoryUserRepository(), db);
    await setup(svc);
    const a = await doLogin(svc);
    const b = await doLogin(svc);
    const c = await doLogin(svc);
    await expect(svc.verifyToken(a.token)).rejects.toThrow(/invalidiert/i);
    await expect(svc.verifyToken(b.token)).resolves.toBeTruthy();
    await expect(svc.verifyToken(c.token)).resolves.toBeTruthy();
  });
});
