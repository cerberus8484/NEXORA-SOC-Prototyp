'use strict';

// ── TDD RED: InMemory-Repository-Tests für ApiToken ──────────────────────────

const { ApiToken }                  = require('../../src/domain/ApiToken');
const { InMemoryApiTokenRepository } = require('../../src/repositories/InMemoryApiTokenRepository');

async function makeToken(repo, { userId = 'u1', name = 'Test', expiresAt = null } = {}) {
  const { token, domain } = await ApiToken.create({ userId, name, expiresAt });
  await repo.save(domain);
  return { token, domain };
}

describe('InMemoryApiTokenRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryApiTokenRepository();
  });

  // ─── save / findById ──────────────────────────────────────────────────────

  describe('save + findById', () => {
    test('speichert und findet ein Token per id', async () => {
      const { domain } = await makeToken(repo);
      const found = await repo.findById(domain.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(domain.id);
    });

    test('gibt null zurück wenn id nicht existiert', async () => {
      const found = await repo.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  // ─── findByHash ───────────────────────────────────────────────────────────

  describe('findByHash', () => {
    test('findet aktives Token per tokenHash', async () => {
      const { domain } = await makeToken(repo);
      const found = await repo.findByHash(domain.tokenHash);
      expect(found).not.toBeNull();
      expect(found.id).toBe(domain.id);
    });

    test('gibt null zurück wenn Hash nicht existiert', async () => {
      const found = await repo.findByHash('nothash');
      expect(found).toBeNull();
    });

    test('gibt null zurück für revoked Token', async () => {
      const { domain } = await makeToken(repo);
      domain.revoked = true;
      await repo.save(domain);
      const found = await repo.findByHash(domain.tokenHash);
      expect(found).toBeNull();
    });
  });

  // ─── listByUser ───────────────────────────────────────────────────────────

  describe('listByUser', () => {
    test('gibt leere Liste wenn kein Token für User', async () => {
      const list = await repo.listByUser('u1');
      expect(list).toEqual([]);
    });

    test('gibt nur Tokens des gefragten Users zurück', async () => {
      await makeToken(repo, { userId: 'u1', name: 'A' });
      await makeToken(repo, { userId: 'u2', name: 'B' });
      await makeToken(repo, { userId: 'u1', name: 'C' });

      const u1List = await repo.listByUser('u1');
      expect(u1List).toHaveLength(2);
      expect(u1List.every(t => t.userId === 'u1')).toBe(true);

      const u2List = await repo.listByUser('u2');
      expect(u2List).toHaveLength(1);
    });

    test('gibt auch revoked Tokens zurück (für Anzeige)', async () => {
      const { domain } = await makeToken(repo, { userId: 'u1' });
      domain.revoked = true;
      await repo.save(domain);

      const list = await repo.listByUser('u1');
      expect(list).toHaveLength(1);
      expect(list[0].revoked).toBe(true);
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────────

  describe('revoke', () => {
    test('setzt revoked auf true', async () => {
      const { domain } = await makeToken(repo, { userId: 'u1' });
      await repo.revoke(domain.id);

      const found = await repo.findById(domain.id);
      expect(found.revoked).toBe(true);
    });

    test('gibt null zurück wenn Token nicht existiert', async () => {
      const result = await repo.revoke('nonexistent');
      expect(result).toBeNull();
    });

    test('nach revoke: findByHash gibt null zurück', async () => {
      const { domain } = await makeToken(repo);
      await repo.revoke(domain.id);
      const found = await repo.findByHash(domain.tokenHash);
      expect(found).toBeNull();
    });
  });

  // ─── updateLastUsed ───────────────────────────────────────────────────────

  describe('updateLastUsed', () => {
    test('setzt lastUsedAt auf aktuellen Timestamp', async () => {
      const { domain } = await makeToken(repo);
      await repo.updateLastUsed(domain.id);

      const found = await repo.findById(domain.id);
      expect(found.lastUsedAt).not.toBeNull();
    });

    test('ignoriert nicht-existente id ohne Fehler', async () => {
      await expect(repo.updateLastUsed('nonexistent')).resolves.not.toThrow();
    });
  });

  // ─── clear (Test-Hilfsmethode) ────────────────────────────────────────────

  describe('clear()', () => {
    test('löscht alle gespeicherten Tokens', async () => {
      await makeToken(repo, { userId: 'u1' });
      await makeToken(repo, { userId: 'u2' });
      repo.clear();

      const list = await repo.listByUser('u1');
      expect(list).toHaveLength(0);
    });
  });
});
