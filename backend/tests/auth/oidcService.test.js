'use strict';

// OIDC Slice 2 — Service-Orchestrierung + Account-Linking-Sicherheit (netzfrei).
const { OidcService } = require('../../src/auth/oidc/oidcService');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');
const { User } = require('../../src/domain/User');

const ISSUER    = 'https://idp.example.com/realms/soc';
const CLIENT_ID = 'soc-client';

function discovery() {
  return {
    issuer:                ISSUER,
    authorizationEndpoint: `${ISSUER}/auth`,
    tokenEndpoint:         `${ISSUER}/token`,
    jwksUri:               `${ISSUER}/jwks`,
  };
}

function baseClaims(overrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER, aud: CLIENT_ID, sub: 'sub-xyz',
    exp: nowSec + 600, iat: nowSec, nonce: 'nonce-1',
    email: 'user@firma.de', email_verified: true,
    ...overrides,
  };
}

function makeService({ users, allowSignup = false, defaultRole = 'viewer', claims = baseClaims(), tokenResponse = { id_token: 'idtok', access_token: 'acc' }, verifyThrows = false } = {}) {
  const userRepository = users || new InMemoryUserRepository();
  const issued = [];
  const authService = {
    _issueSession: async (user) => {
      issued.push(user);
      return { token: `tok-${user.id}`, jti: 'jti-1', user: user.toPublicJSON() };
    },
  };
  const calls = { exchange: 0, verify: 0 };
  const svc = new OidcService({
    config: { issuer: ISSUER, clientId: CLIENT_ID, redirectUri: `${ISSUER}/cb`, scope: 'openid email', defaultRole, allowSignup },
    discover:     async () => discovery(),
    exchangeCode: async () => { calls.exchange += 1; return tokenResponse; },
    verifyIdToken: async () => {
      calls.verify += 1;
      if (verifyThrows) throw new Error('bad signature');
      return claims;
    },
    userRepository,
    authService,
  });
  return { svc, userRepository, issued, calls };
}

const FLOW = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier-1' };
const goodArgs = (overrides = {}) => ({ code: 'auth-code', returnedState: 'state-1', flow: FLOW, ...overrides });

async function expectReason(promise, reason) {
  await expect(promise).rejects.toMatchObject({ name: 'OidcError', reason });
}

describe('OidcService.beginLogin', () => {
  test('baut Authorization-URL mit state/nonce/PKCE + liefert Flow-Zustand', async () => {
    const { svc } = makeService();
    const { authorizationUrl, flow } = await svc.beginLogin();

    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(flow.state);
    expect(url.searchParams.get('nonce')).toBe(flow.nonce);
    expect(url.searchParams.get('code_challenge')).toBeTruthy();

    expect(flow.codeVerifier).toEqual(expect.any(String));
    expect(flow.state).toEqual(expect.any(String));
    expect(flow.nonce).toEqual(expect.any(String));
  });
});

describe('OidcService.completeLogin — Erfolgspfade', () => {
  test('bestehende Verknüpfung (provider, sub) → Session, linkMode=existing', async () => {
    const users = new InMemoryUserRepository();
    const linked = new User({ email: 'user@firma.de', oidcProvider: ISSUER, oidcSub: 'sub-xyz', role: 'analyst' });
    await users.save(linked);
    const { svc, issued } = makeService({ users });

    const res = await svc.completeLogin(goodArgs());
    expect(res.linkMode).toBe('existing');
    expect(res.userId).toBe(linked.id);
    expect(res.session.token).toBe(`tok-${linked.id}`);
    expect(issued).toHaveLength(1);
  });

  test('Linking auf bestehenden Account per VERIFIZIERTER E-Mail', async () => {
    const users = new InMemoryUserRepository();
    const pwUser = new User({ email: 'user@firma.de', role: 'engineer' }); // kein OIDC-Link
    await users.save(pwUser);
    const { svc, issued } = makeService({ users });

    const res = await svc.completeLogin(goodArgs());
    expect(res.linkMode).toBe('linked');

    // Persistent verknüpft: ab jetzt über die Identität auffindbar.
    const nowLinked = await users.findByOidcIdentity(ISSUER, 'sub-xyz');
    expect(nowLinked.id).toBe(pwUser.id);
    expect(nowLinked.oidcSub).toBe('sub-xyz');
    expect(nowLinked.role).toBe('engineer'); // Rolle bleibt unverändert
    expect(issued).toHaveLength(1);
  });

  test('Auto-Signup (allowSignup) → neuer User mit Default-Rolle, ohne Passwort', async () => {
    const { svc, userRepository, issued } = makeService({ allowSignup: true, defaultRole: 'viewer' });

    const res = await svc.completeLogin(goodArgs());
    expect(res.linkMode).toBe('created');

    const created = await userRepository.findByEmail('user@firma.de');
    expect(created).not.toBeNull();
    expect(created.role).toBe('viewer');
    expect(created.passwordHash).toBe('');           // kein Passwort-Login möglich
    expect(created.oidcSub).toBe('sub-xyz');
    expect(issued).toHaveLength(1);
  });
});

describe('OidcService.completeLogin — Sicherheits-Abweisungen', () => {
  test('state-Mismatch → state_mismatch, KEIN Token-Tausch', async () => {
    const { svc, calls, issued } = makeService();
    await expectReason(svc.completeLogin(goodArgs({ returnedState: 'forged' })), 'state_mismatch');
    expect(calls.exchange).toBe(0);
    expect(issued).toHaveLength(0);
  });

  test('fehlender Code → missing_code', async () => {
    const { svc } = makeService();
    await expectReason(svc.completeLogin(goodArgs({ code: '' })), 'missing_code');
  });

  test('fehlender/kaputter Flow → missing_flow', async () => {
    const { svc } = makeService();
    await expectReason(svc.completeLogin(goodArgs({ flow: { state: 'state-1' } })), 'missing_flow');
  });

  test('Token-Response ohne id_token → no_id_token', async () => {
    const { svc } = makeService({ tokenResponse: { access_token: 'acc' } });
    await expectReason(svc.completeLogin(goodArgs()), 'no_id_token');
  });

  test('Signaturprüfung wirft → signature_invalid', async () => {
    const { svc } = makeService({ verifyThrows: true });
    await expectReason(svc.completeLogin(goodArgs()), 'signature_invalid');
  });

  test('nonce-Mismatch → claims_nonce_mismatch (Replay-Schutz)', async () => {
    const { svc } = makeService({ claims: baseClaims({ nonce: 'andere-nonce' }) });
    await expectReason(svc.completeLogin(goodArgs()), 'claims_nonce_mismatch');
  });

  test('falscher issuer im Token → claims_issuer_mismatch', async () => {
    const { svc } = makeService({ claims: baseClaims({ iss: 'https://evil-idp' }) });
    await expectReason(svc.completeLogin(goodArgs()), 'claims_issuer_mismatch');
  });

  test('UNverifizierte E-Mail linkt NICHT auf bestehenden Account (Takeover-Schutz)', async () => {
    const users = new InMemoryUserRepository();
    const victim = new User({ email: 'user@firma.de', role: 'admin' });
    await users.save(victim);
    const { svc, issued } = makeService({ users, claims: baseClaims({ email_verified: false }) });

    await expectReason(svc.completeLogin(goodArgs()), 'email_unverified');
    expect(await users.findByOidcIdentity(ISSUER, 'sub-xyz')).toBeNull(); // nicht verknüpft
    expect(issued).toHaveLength(0);                                       // keine Session
  });

  test('verifizierte E-Mail ohne lokalen Account + kein Signup → no_local_account', async () => {
    const { svc } = makeService(); // leeres Repo, allowSignup=false
    await expectReason(svc.completeLogin(goodArgs()), 'no_local_account');
  });

  test('inaktiver verknüpfter User → user_inactive', async () => {
    const users = new InMemoryUserRepository();
    await users.save(new User({ email: 'user@firma.de', oidcProvider: ISSUER, oidcSub: 'sub-xyz', isActive: false }));
    const { svc, issued } = makeService({ users });
    await expectReason(svc.completeLogin(goodArgs()), 'user_inactive');
    expect(issued).toHaveLength(0);
  });

  test('Signup mit unverifizierter E-Mail → signup_requires_verified_email', async () => {
    const { svc } = makeService({ allowSignup: true, claims: baseClaims({ email_verified: false }) });
    await expectReason(svc.completeLogin(goodArgs()), 'signup_requires_verified_email');
  });
});
