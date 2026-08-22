'use strict';

// ── TDD RED: WebAuthnService (Slice 2b) — Ceremony-Orchestrierung ────────────
// Netz-/krypto-frei: die Verifikation (verifyRegistration/verifyAuthentication)
// wird INJIZIERT (im Prod-Wiring = @simplewebauthn/server). Repo = echtes InMemory.
//
// Sicherheits-Invarianten (hart):
//   - nicht-verifizierte Response → Fehler, kein Credential/keine Session
//   - Counter-Clone (newCounter <= gespeichert, beide >0) → abgelehnt
//   - unbekanntes/inaktives → einheitlicher, nicht-diskriminierender Login-Fehler
//   - Fehlergrund nur serverseitig, nie in der Exception-Message als Detail

const { WebAuthnService } = require('../../src/auth/webauthn/webAuthnService');
const { InMemoryWebAuthnCredentialRepository } = require('../../src/repositories/InMemoryWebAuthnCredentialRepository');
const { WebAuthnCredential } = require('../../src/domain/WebAuthnCredential');

const CONFIG = { enabled: true, rpId: 'nexora.example', rpName: 'Nexora SOC', origin: 'https://nexora.example', timeoutMs: 60000 };

function makeService(over = {}) {
  const credentialRepo = over.credentialRepo || new InMemoryWebAuthnCredentialRepository();
  const users = over.users || new Map();
  const userRepository = {
    findById: async (id) => users.get(id) || null,
  };
  const issued = [];
  const authService = { _issueSession: async (user) => { issued.push(user); return { token: 'tok', user: { id: user.id } }; } };
  const service = new WebAuthnService({
    config: over.config || CONFIG,
    credentialRepo,
    userRepository,
    authService,
    verifyRegistration:   over.verifyRegistration   || (async () => ({ verified: true, credential: { credentialId: 'newcred', publicKey: 'pk', counter: 1, transports: ['usb'] } })),
    verifyAuthentication: over.verifyAuthentication || (async () => ({ verified: true, newCounter: 6 })),
  });
  return { service, credentialRepo, users, issued };
}

// ── Registration ────────────────────────────────────────────────────────────

describe('WebAuthnService.beginRegistration()', () => {
  test('liefert options (mit challenge) + flow (userId + challenge)', async () => {
    const { service } = makeService();
    const user = { id: 'u1', email: 'a@nexora.example', displayName: 'Alice' };
    const { options, flow } = await service.beginRegistration(user);
    expect(options.challenge).toBe(flow.challenge);
    expect(typeof flow.challenge).toBe('string');
    expect(flow.userId).toBe('u1');
    expect(options.rp.id).toBe('nexora.example');
  });

  test('excludeCredentials enthält bereits registrierte Authenticatoren', async () => {
    const { service, credentialRepo } = makeService();
    await credentialRepo.create(new WebAuthnCredential({ userId: 'u1', credentialId: 'old', publicKey: 'pk', transports: ['nfc'] }));
    const { options } = await service.beginRegistration({ id: 'u1', email: 'a@x', displayName: 'A' });
    expect(options.excludeCredentials.map((c) => c.id)).toContain('old');
  });
});

describe('WebAuthnService.finishRegistration()', () => {
  test('verify ok → Credential gespeichert (Listing-Sicht zurück)', async () => {
    const { service, credentialRepo } = makeService();
    const flow = { challenge: 'chal', userId: 'u1', type: 'registration' };
    const pub = await service.finishRegistration({ flow, response: {}, label: 'YubiKey' });
    expect(pub.label).toBe('YubiKey');
    const stored = await credentialRepo.findByCredentialId('newcred');
    expect(stored.userId).toBe('u1');
    expect(stored.counter).toBe(1);
  });

  test('verify NICHT verifiziert → wirft, kein Credential', async () => {
    const { service, credentialRepo } = makeService({ verifyRegistration: async () => ({ verified: false }) });
    await expect(service.finishRegistration({ flow: { challenge: 'c', userId: 'u1' }, response: {} })).rejects.toThrow();
    expect(await credentialRepo.findByUserId('u1')).toEqual([]);
  });

  test('Gate aus → wirft (kein Storage)', async () => {
    const { service } = makeService({ config: { ...CONFIG, enabled: false } });
    await expect(service.finishRegistration({ flow: { challenge: 'c', userId: 'u1' }, response: {} })).rejects.toThrow();
  });
});

// ── Authentication ──────────────────────────────────────────────────────────

describe('WebAuthnService.finishAuthentication()', () => {
  async function seed(over = {}) {
    const ctx = makeService(over);
    ctx.users.set('u1', { id: 'u1', email: 'a@x', isActive: true });
    await ctx.credentialRepo.create(new WebAuthnCredential({ userId: 'u1', credentialId: 'cred-1', publicKey: 'pk', counter: 5 }));
    return ctx;
  }

  test('verify ok + Counter steigt → updateCounter + Session', async () => {
    const ctx = await seed();
    const res = await ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'cred-1' } });
    expect(res.token).toBe('tok');
    expect(ctx.issued[0].id).toBe('u1');
    expect((await ctx.credentialRepo.findByCredentialId('cred-1')).counter).toBe(6);
  });

  test('unbekanntes credentialId → einheitlicher Fehler, keine Session', async () => {
    const ctx = await seed();
    await expect(ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'nope' } })).rejects.toThrow();
    expect(ctx.issued).toEqual([]);
  });

  test('Counter-Clone (newCounter <= gespeichert) → abgelehnt', async () => {
    const ctx = await seed({ verifyAuthentication: async () => ({ verified: true, newCounter: 5 }) });
    await expect(ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'cred-1' } })).rejects.toThrow();
    expect(ctx.issued).toEqual([]);
  });

  test('verify NICHT verifiziert → Fehler', async () => {
    const ctx = await seed({ verifyAuthentication: async () => ({ verified: false }) });
    await expect(ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'cred-1' } })).rejects.toThrow();
  });

  test('inaktiver User → Fehler, keine Session', async () => {
    const ctx = await seed();
    ctx.users.set('u1', { id: 'u1', email: 'a@x', isActive: false });
    await expect(ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'cred-1' } })).rejects.toThrow();
    expect(ctx.issued).toEqual([]);
  });

  test('Fehler-Message ist generisch (kein interner reason geleakt)', async () => {
    const ctx = await seed({ verifyAuthentication: async () => ({ verified: false }) });
    let msg = '';
    try { await ctx.service.finishAuthentication({ flow: { challenge: 'c' }, response: { id: 'cred-1' } }); }
    catch (e) { msg = e.message; }
    expect(msg).not.toMatch(/not_verified|counter|clone|reason/i);
  });
});
