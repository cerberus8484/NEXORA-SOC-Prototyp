'use strict';

// ── TDD RED: Service-Tests für ApiTokenService ──────────────────────────────

const { ApiTokenService }            = require('../../src/services/ApiTokenService');
const { InMemoryApiTokenRepository } = require('../../src/repositories/InMemoryApiTokenRepository');
const { InMemoryUserRepository }     = require('../../src/repositories/InMemoryUserRepository');
const { User }                       = require('../../src/domain/User');

function makeService() {
  const tokenRepo = new InMemoryApiTokenRepository();
  const userRepo  = new InMemoryUserRepository();
  const service   = new ApiTokenService({ tokenRepo, userRepo });
  return { service, tokenRepo, userRepo };
}

async function seedUser(userRepo, { id = 'u1', role = 'analyst' } = {}) {
  const user = new User({ id, email: `${id}@test.io`, displayName: 'Test', role });
  await userRepo.save(user);
  return user;
}

describe('ApiTokenService', () => {

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    test('gibt { token (plain), apiToken (domain ohne hash) } zurück', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);

      const result = await service.create({ userId: 'u1', name: 'Mein Skript' });
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('apiToken');
      expect(result.token).toMatch(/^soc_[0-9a-f]{64}$/);
    });

    test('apiToken enthält kein tokenHash', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);

      const { apiToken } = await service.create({ userId: 'u1', name: 'T' });
      expect(apiToken).not.toHaveProperty('tokenHash');
      expect(apiToken).not.toHaveProperty('token_hash');
    });

    test('Token wird im Repo gespeichert (hash)', async () => {
      const { service, userRepo, tokenRepo } = makeService();
      await seedUser(userRepo);

      const { apiToken } = await service.create({ userId: 'u1', name: 'T' });
      const stored = await tokenRepo.findById(apiToken.id);
      expect(stored).not.toBeNull();
      expect(stored.tokenHash).toBeDefined();
    });

    test('wirft wenn userId fehlt', async () => {
      const { service } = makeService();
      await expect(service.create({ name: 'T' }))
        .rejects.toThrow(/userId/i);
    });

    test('wirft wenn name fehlt', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);
      await expect(service.create({ userId: 'u1' }))
        .rejects.toThrow(/name/i);
    });

    test('mit expiresAt: apiToken.expiresAt gesetzt', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);
      const exp = new Date(Date.now() + 86400000).toISOString();

      const { apiToken } = await service.create({ userId: 'u1', name: 'T', expiresAt: exp });
      expect(apiToken.expiresAt).toBe(exp);
    });
  });

  // ─── listByUser ───────────────────────────────────────────────────────────

  describe('listByUser()', () => {
    test('gibt leere Liste wenn keine Tokens', async () => {
      const { service } = makeService();
      const list = await service.listByUser('u1');
      expect(list).toEqual([]);
    });

    test('gibt Tokens des Users zurück (ohne hash)', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);

      await service.create({ userId: 'u1', name: 'A' });
      await service.create({ userId: 'u1', name: 'B' });

      const list = await service.listByUser('u1');
      expect(list).toHaveLength(2);
      list.forEach(t => {
        expect(t).not.toHaveProperty('tokenHash');
        expect(t.userId).toBe('u1');
      });
    });

    test('User-Scoping: gibt nur eigene Tokens zurück', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo, { id: 'u1' });
      await seedUser(userRepo, { id: 'u2' });

      await service.create({ userId: 'u1', name: 'A' });
      await service.create({ userId: 'u2', name: 'B' });

      expect(await service.listByUser('u1')).toHaveLength(1);
      expect(await service.listByUser('u2')).toHaveLength(1);
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────────

  describe('revoke()', () => {
    test('setzt Token auf revoked', async () => {
      const { service, userRepo, tokenRepo } = makeService();
      await seedUser(userRepo);

      const { apiToken } = await service.create({ userId: 'u1', name: 'T' });
      await service.revoke({ tokenId: apiToken.id, userId: 'u1' });

      const stored = await tokenRepo.findById(apiToken.id);
      expect(stored.revoked).toBe(true);
    });

    test('wirft 404-ähnlichen Fehler wenn Token nicht existiert', async () => {
      const { service } = makeService();
      await expect(service.revoke({ tokenId: 'nope', userId: 'u1' }))
        .rejects.toThrow(/not found|404/i);
    });

    test('wirft Fehler wenn Token einem anderen User gehört (ownership)', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo, { id: 'u1' });
      await seedUser(userRepo, { id: 'u2' });

      const { apiToken } = await service.create({ userId: 'u1', name: 'T' });

      // u2 versucht u1s Token zu widerrufen
      await expect(service.revoke({ tokenId: apiToken.id, userId: 'u2' }))
        .rejects.toThrow(/not found|forbidden|unauthorized/i);
    });
  });

  // ─── authenticate ─────────────────────────────────────────────────────────

  describe('authenticate()', () => {
    test('gibt { userId, tokenId } für gültigen Token zurück', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);

      const { token, apiToken } = await service.create({ userId: 'u1', name: 'T' });
      const result = await service.authenticate(token);

      expect(result).not.toBeNull();
      expect(result.userId).toBe('u1');
      expect(result.tokenId).toBe(apiToken.id);
    });

    test('gibt null für unbekannten Token zurück', async () => {
      const { service } = makeService();
      const result = await service.authenticate('soc_' + 'a'.repeat(64));
      expect(result).toBeNull();
    });

    test('gibt null für revoked Token zurück', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);

      const { token, apiToken } = await service.create({ userId: 'u1', name: 'T' });
      await service.revoke({ tokenId: apiToken.id, userId: 'u1' });

      const result = await service.authenticate(token);
      expect(result).toBeNull();
    });

    test('gibt null für abgelaufenen Token zurück', async () => {
      const { service, userRepo } = makeService();
      await seedUser(userRepo);
      const past = new Date(Date.now() - 1000).toISOString();

      const { token } = await service.create({ userId: 'u1', name: 'T', expiresAt: past });
      const result = await service.authenticate(token);
      expect(result).toBeNull();
    });

    test('gibt null für Token zurück der nicht mit soc_ beginnt', async () => {
      const { service } = makeService();
      const result = await service.authenticate('Bearer eyJhbGciOiJIUzI1NiJ9.abc');
      expect(result).toBeNull();
    });

    test('gibt null für leeren String zurück', async () => {
      const { service } = makeService();
      const result = await service.authenticate('');
      expect(result).toBeNull();
    });

    test('gibt null für null zurück', async () => {
      const { service } = makeService();
      const result = await service.authenticate(null);
      expect(result).toBeNull();
    });
  });
});
