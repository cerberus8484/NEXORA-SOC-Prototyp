'use strict';

// ── TDD RED: Domain-Tests für ApiToken ──────────────────────────────────────

const { ApiToken } = require('../../src/domain/ApiToken');

describe('ApiToken Domain', () => {

  // ─── create() ─────────────────────────────────────────────────────────────

  describe('create() — Happy-Path', () => {
    test('gibt { token (plain), domain } zurück', async () => {
      const result = await ApiToken.create({ userId: 'u1', name: 'Mein Skript' });
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('domain');
      expect(typeof result.token).toBe('string');
      expect(result.domain).toBeInstanceOf(ApiToken);
    });

    test('Token startet mit soc_', async () => {
      const { token } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(token).toMatch(/^soc_/);
    });

    test('Token hat genau 68 Zeichen (soc_ + 64 hex)', async () => {
      const { token } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      // soc_ (4) + 32 bytes als hex (64) = 68
      expect(token).toHaveLength(68);
    });

    test('Token-Format ist soc_ + 64 hex chars', async () => {
      const { token } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(token).toMatch(/^soc_[0-9a-f]{64}$/);
    });

    test('jeder create()-Aufruf erzeugt eindeutigen Token', async () => {
      const r1 = await ApiToken.create({ userId: 'u1', name: 'A' });
      const r2 = await ApiToken.create({ userId: 'u1', name: 'B' });
      expect(r1.token).not.toBe(r2.token);
    });

    test('domain.id ist definiert und ein String', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(typeof domain.id).toBe('string');
      expect(domain.id.length).toBeGreaterThan(0);
    });

    test('domain.userId entspricht dem übergebenen userId', async () => {
      const { domain } = await ApiToken.create({ userId: 'u42', name: 'Test' });
      expect(domain.userId).toBe('u42');
    });

    test('domain.name entspricht dem übergebenen name', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Mein Token' });
      expect(domain.name).toBe('Mein Token');
    });

    test('domain.prefix enthält erste 12 Zeichen inkl. soc_ + ...', async () => {
      const { token, domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      // soc_XXXXXXXX... — erste 12 Zeichen + "..."
      expect(domain.prefix).toBe(token.slice(0, 12) + '...');
    });

    test('domain.tokenHash ist SHA-256-Hash des Tokens (64 hex chars)', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(domain.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('domain.revoked ist false nach Erstellung', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(domain.revoked).toBe(false);
    });

    test('domain.createdAt ist gesetzt', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(domain.createdAt).toBeDefined();
    });

    test('domain.expiresAt ist null wenn nicht angegeben', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test' });
      expect(domain.expiresAt).toBeNull();
    });

    test('domain.expiresAt übernimmt übergebenen Wert', async () => {
      const exp = new Date(Date.now() + 86400000).toISOString();
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Test', expiresAt: exp });
      expect(domain.expiresAt).toBe(exp);
    });
  });

  describe('create() — Validierung', () => {
    test('wirft wenn userId fehlt', async () => {
      await expect(ApiToken.create({ name: 'Test' }))
        .rejects.toThrow(/userId/i);
    });

    test('wirft wenn userId leer', async () => {
      await expect(ApiToken.create({ userId: '', name: 'Test' }))
        .rejects.toThrow(/userId/i);
    });

    test('wirft wenn name fehlt', async () => {
      await expect(ApiToken.create({ userId: 'u1' }))
        .rejects.toThrow(/name/i);
    });

    test('wirft wenn name leer', async () => {
      await expect(ApiToken.create({ userId: 'u1', name: '' }))
        .rejects.toThrow(/name/i);
    });

    test('wirft wenn name zu lang (>100 chars)', async () => {
      await expect(ApiToken.create({ userId: 'u1', name: 'x'.repeat(101) }))
        .rejects.toThrow(/name/i);
    });
  });

  // ─── fromRow() ────────────────────────────────────────────────────────────

  describe('fromRow() — Rekonstruktion aus DB-Daten', () => {
    const row = {
      id: 'fixed-uuid',
      user_id: 'u99',
      name: 'Skript-Token',
      token_hash: 'abc'.repeat(21) + 'x',  // 64 hex chars (fake)
      prefix: 'soc_a3f9b2c...',
      last_used_at: null,
      expires_at: null,
      revoked: false,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    test('fromRow() hydratisiert korrekt', () => {
      const t = ApiToken.fromRow(row);
      expect(t).toBeInstanceOf(ApiToken);
      expect(t.id).toBe('fixed-uuid');
      expect(t.userId).toBe('u99');
      expect(t.name).toBe('Skript-Token');
      expect(t.prefix).toBe('soc_a3f9b2c...');
      expect(t.revoked).toBe(false);
      expect(t.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    test('fromRow() behält tokenHash intern', () => {
      const t = ApiToken.fromRow(row);
      expect(t.tokenHash).toBeDefined();
    });
  });

  // ─── isExpired / isActive ────────────────────────────────────────────────

  describe('isExpired', () => {
    test('false wenn kein expiresAt', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      expect(domain.isExpired).toBe(false);
    });

    test('true wenn expiresAt in der Vergangenheit', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T', expiresAt: past });
      expect(domain.isExpired).toBe(true);
    });

    test('false wenn expiresAt in der Zukunft', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T', expiresAt: future });
      expect(domain.isExpired).toBe(false);
    });
  });

  describe('isActive', () => {
    test('true wenn nicht revoked und nicht abgelaufen', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      expect(domain.isActive).toBe(true);
    });

    test('false wenn revoked', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      domain.revoked = true;
      expect(domain.isActive).toBe(false);
    });

    test('false wenn abgelaufen', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T', expiresAt: past });
      expect(domain.isActive).toBe(false);
    });
  });

  // ─── toJSON() ─────────────────────────────────────────────────────────────

  describe('toJSON()', () => {
    test('enthält id, userId, name, prefix, createdAt, revoked, expiresAt', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'Mein Token' });
      const json = domain.toJSON();
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('userId');
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('prefix');
      expect(json).toHaveProperty('createdAt');
      expect(json).toHaveProperty('revoked');
      expect(json).toHaveProperty('expiresAt');
    });

    test('NIEMALS tokenHash in toJSON()', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      const json = domain.toJSON();
      expect(json).not.toHaveProperty('tokenHash');
      expect(json).not.toHaveProperty('token_hash');
    });

    test('NIEMALS rohen Token-Wert in toJSON()', async () => {
      const { token, domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      const json = domain.toJSON();
      const serialized = JSON.stringify(json);
      expect(serialized).not.toContain(token.slice(4)); // ohne soc_-Prefix
    });

    test('JSON.stringify() gibt kein tokenHash aus', async () => {
      const { domain } = await ApiToken.create({ userId: 'u1', name: 'T' });
      const str = JSON.stringify(domain);
      expect(str).not.toContain('tokenHash');
      expect(str).not.toContain('token_hash');
    });
  });
});
