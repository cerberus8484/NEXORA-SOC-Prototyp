'use strict';

// ── Block B.1: BCRYPT_ROUNDS aus ENV (users.js + UserService.js) ─────────────
// Beide Module nutzen jetzt resolveBcryptRounds({ rounds: ENV, nodeEnv }) statt
// einer fest verdrahteten 12. Beweis: ein gesetzter BCRYPT_ROUNDS-Wert landet im
// erzeugten bcrypt-Hash (Cost-Faktor $2b$NN$), und ein Prod-Wert < 12 wirft beim
// Modul-Load (Fail-fast). resolveBcryptRounds selbst ist separat unit-getestet
// (jwtSecretGuard.test.js) — hier geht es um die Verdrahtung.

const ORIG = { rounds: process.env.BCRYPT_ROUNDS, nodeEnv: process.env.NODE_ENV, jwt: process.env.JWT_SECRET };

// Gültiges JWT_SECRET, damit im Prod-Pfad der JWT-Guard (läuft VOR dem Bcrypt-Guard
// beim AuthService-Load) nicht zuerst wirft — wir wollen gezielt den BCRYPT-Wurf prüfen.
const VALID_JWT = 'x'.repeat(40);

afterEach(() => {
  if (ORIG.rounds == null) delete process.env.BCRYPT_ROUNDS; else process.env.BCRYPT_ROUNDS = ORIG.rounds;
  if (ORIG.jwt == null) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = ORIG.jwt;
  process.env.NODE_ENV = ORIG.nodeEnv;
  jest.resetModules();
});

// bcrypt-Hash kodiert die Rounds als zweistellige Zahl: $2b$NN$...
const costOf = (hash) => parseInt(hash.split('$')[2], 10);

describe('UserService — BCRYPT_ROUNDS aus ENV', () => {
  test('gesetzter BCRYPT_ROUNDS-Wert wird im resetPassword-Hash verwendet', async () => {
    process.env.NODE_ENV = 'test';
    process.env.BCRYPT_ROUNDS = '6'; // explizit, überschreibt den Test-Default 4
    jest.resetModules();

    const { UserService } = require('../../src/services/UserService');
    const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
    const { User } = require('../../src/domain/User');

    const repo = new InMemoryUserRepository();
    await repo.save(new User({ id: 'u1', email: 'u1@test.io', passwordHash: 'x', role: 'analyst' }));
    const svc = new UserService(repo);

    await svc.resetPassword('u1');
    const stored = await repo.findById('u1');
    expect(costOf(stored.passwordHash)).toBe(6);
  });

  test('Prod mit BCRYPT_ROUNDS < 12 → Modul-Load wirft (Fail-fast)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = VALID_JWT;
    process.env.BCRYPT_ROUNDS = '4';
    jest.resetModules();

    expect(() => require('../../src/services/UserService')).toThrow(/BCRYPT_ROUNDS/);
  });
});

describe('routes/users — BCRYPT_ROUNDS aus ENV', () => {
  test('Prod mit BCRYPT_ROUNDS < 12 → Route-Modul-Load wirft (Fail-fast)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = VALID_JWT;
    process.env.BCRYPT_ROUNDS = '8';
    jest.resetModules();

    expect(() => require('../../src/routes/users')).toThrow(/BCRYPT_ROUNDS/);
  });
});
