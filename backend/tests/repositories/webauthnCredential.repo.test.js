'use strict';

// ── TDD RED: WebAuthn-Credential-Storage (Slice 2a) ─────────────────────────
// Domain + InMemory-Repo-Vertrag + Postgres-Row-Mapping (ohne DB).
//
// Invarianten:
//   - credentialId ist eindeutig (kein Identitäts-Sharing zwischen Authenticatoren)
//   - delete ist ownership-scoped (kein Fremd-Löschen)
//   - toPublicJSON gibt NIE credentialId/publicKey raus (Listing-sichere Sicht)
//   - Postgres-Mapping: snake->camel, jsonb-transports geparst, Date->ISO

const { WebAuthnCredential } = require('../../src/domain/WebAuthnCredential');
const { InMemoryWebAuthnCredentialRepository } = require('../../src/repositories/InMemoryWebAuthnCredentialRepository');
const { PostgresWebAuthnCredentialRepository } = require('../../src/repositories/PostgresWebAuthnCredentialRepository');

// ── Domain ────────────────────────────────────────────────────────────────────

describe('WebAuthnCredential (Domain)', () => {
  test('setzt Defaults (counter 0, transports [], backedUp false)', () => {
    const c = new WebAuthnCredential({ userId: 'u1', credentialId: 'cred-1', publicKey: 'pk-1' });
    expect(c.id).toBeDefined();
    expect(c.counter).toBe(0);
    expect(c.transports).toEqual([]);
    expect(c.backedUp).toBe(false);
    expect(c.createdAt).toBeDefined();
  });

  test('toPublicJSON gibt Listing-Felder, aber NIE credentialId/publicKey', () => {
    const c = new WebAuthnCredential({
      userId: 'u1', credentialId: 'cred-secret', publicKey: 'pk-secret',
      label: 'YubiKey 5', transports: ['usb'], backedUp: true,
    });
    const pub = c.toPublicJSON();
    expect(pub.label).toBe('YubiKey 5');
    expect(pub.transports).toEqual(['usb']);
    expect(pub.backedUp).toBe(true);
    const str = JSON.stringify(pub);
    expect(str).not.toContain('cred-secret');
    expect(str).not.toContain('pk-secret');
  });
});

// ── InMemory-Repo-Vertrag ───────────────────────────────────────────────────

describe('InMemoryWebAuthnCredentialRepository', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryWebAuthnCredentialRepository(); });

  const make = (over = {}) => new WebAuthnCredential({
    userId: 'u1', credentialId: 'cred-1', publicKey: 'pk-1', ...over,
  });

  test('create + findByCredentialId', async () => {
    await repo.create(make());
    const found = await repo.findByCredentialId('cred-1');
    expect(found.userId).toBe('u1');
  });

  test('findByCredentialId gibt null bei unbekanntem', async () => {
    expect(await repo.findByCredentialId('nope')).toBeNull();
  });

  test('findByUserId gibt alle Credentials des Users (leer = [])', async () => {
    await repo.create(make({ credentialId: 'c1' }));
    await repo.create(make({ credentialId: 'c2' }));
    await repo.create(make({ userId: 'u2', credentialId: 'c3' }));
    const list = await repo.findByUserId('u1');
    expect(list.map((c) => c.credentialId).sort()).toEqual(['c1', 'c2']);
    expect(await repo.findByUserId('unknown')).toEqual([]);
  });

  test('create wirft bei doppelter credentialId (kein Identitäts-Sharing)', async () => {
    await repo.create(make({ credentialId: 'dup' }));
    await expect(repo.create(make({ userId: 'u2', credentialId: 'dup' }))).rejects.toThrow();
  });

  test('updateCounter erhöht counter + setzt lastUsedAt', async () => {
    await repo.create(make({ credentialId: 'c1', counter: 5 }));
    const updated = await repo.updateCounter('c1', 9);
    expect(updated.counter).toBe(9);
    expect(updated.lastUsedAt).toBeDefined();
    expect((await repo.findByCredentialId('c1')).counter).toBe(9);
  });

  test('updateCounter gibt null bei unbekanntem credentialId', async () => {
    expect(await repo.updateCounter('nope', 1)).toBeNull();
  });

  test('deleteById ist ownership-scoped', async () => {
    const c = make({ credentialId: 'c1' });
    await repo.create(c);
    expect(await repo.deleteById(c.id, 'u2')).toBe(false);   // fremder User → kein Löschen
    expect(await repo.findByCredentialId('c1')).not.toBeNull();
    expect(await repo.deleteById(c.id, 'u1')).toBe(true);    // Eigentümer → gelöscht
    expect(await repo.findByCredentialId('c1')).toBeNull();
  });
});

// ── Postgres-Row-Mapping (ohne DB) ──────────────────────────────────────────

describe('PostgresWebAuthnCredentialRepository._toWebAuthnCredential', () => {
  test('mappt snake_case-Row → Domain (transports jsonb, Date→ISO)', () => {
    const repo = new PostgresWebAuthnCredentialRepository();
    const row = {
      id: 'id-1', user_id: 'u1', credential_id: 'cred-1', public_key: 'pk-1',
      counter: '7', transports: ['usb', 'nfc'], device_type: 'multiDevice',
      backed_up: true, label: 'Key', created_at: new Date('2026-06-20T00:00:00.000Z'),
      last_used_at: new Date('2026-06-20T01:00:00.000Z'),
    };
    const c = repo._toWebAuthnCredential(row);
    expect(c).toMatchObject({
      id: 'id-1', userId: 'u1', credentialId: 'cred-1', publicKey: 'pk-1',
      counter: 7, transports: ['usb', 'nfc'], deviceType: 'multiDevice',
      backedUp: true, label: 'Key',
    });
    expect(c.createdAt).toBe('2026-06-20T00:00:00.000Z');
    expect(c.lastUsedAt).toBe('2026-06-20T01:00:00.000Z');
  });

  test('transports als JSON-String wird geparst; null last_used_at bleibt null', () => {
    const repo = new PostgresWebAuthnCredentialRepository();
    const c = repo._toWebAuthnCredential({
      id: 'id-2', user_id: 'u1', credential_id: 'c', public_key: 'pk',
      counter: 0, transports: '["internal"]', device_type: null,
      backed_up: false, label: null, created_at: new Date('2026-06-20T00:00:00.000Z'), last_used_at: null,
    });
    expect(c.transports).toEqual(['internal']);
    expect(c.lastUsedAt).toBeNull();
  });
});
