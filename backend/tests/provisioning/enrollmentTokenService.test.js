'use strict';

// P_AGENT_1 — EnrollmentTokenService: Mint, Hash-only-Storage, Auth-Guards, Redaction.
const { EnrollmentTokenService } = require('../../src/services/EnrollmentTokenService');
const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { EnrollmentToken, AUDIT_EVENTS } = require('../../src/provisioning/provisioningDomain');

let repo; let svc; let profile;
beforeEach(async () => {
  repo = new InMemoryProvisioningRepository();
  svc = new EnrollmentTokenService({ repo });
  profile = await repo.createEnrollmentProfile({ name: 'lab-sensor', role: 'network_sensor', capabilities: ['inventory'] });
});

describe('EnrollmentTokenService — Mint + Hashing', () => {
  test('mintToken liefert Klartext-Token (enr_-Präfix) einmalig', async () => {
    const { token, enrollmentToken } = await svc.mintToken({ enrollmentProfileId: profile.id });
    expect(typeof token).toBe('string');
    expect(token.startsWith('enr_')).toBe(true);
    expect(enrollmentToken).toHaveProperty('id');
    expect(enrollmentToken).toHaveProperty('prefix');
  });

  test('Response enthält KEINEN tokenHash und KEIN token-Feld', async () => {
    const { enrollmentToken } = await svc.mintToken({ enrollmentProfileId: profile.id });
    expect(enrollmentToken).not.toHaveProperty('tokenHash');
    expect(enrollmentToken).not.toHaveProperty('token');
  });

  test('Im Repository wird nur der Hash gespeichert (Lookup per Hash, nicht per Klartext)', async () => {
    const { token } = await svc.mintToken({ enrollmentProfileId: profile.id });
    // Klartext findet NICHTS, der Hash findet den Record (ohne Hash-Feld).
    expect(await repo.findEnrollmentTokenByHash(token)).toBeNull();
    const rec = await repo.findEnrollmentTokenByHash(EnrollmentToken.hash(token));
    expect(rec).not.toBeNull();
    expect(rec).not.toHaveProperty('tokenHash');
  });

  test('mint für unbekanntes Profil → 404', async () => {
    await expect(svc.mintToken({ enrollmentProfileId: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('mint für revoked Profil → 409', async () => {
    await repo.transitionEnrollmentProfile(profile.id, 'revoked');
    await expect(svc.mintToken({ enrollmentProfileId: profile.id })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('EnrollmentTokenService — authenticate Guards', () => {
  test('gültiger Token → { tokenId, profile }', async () => {
    const { token } = await svc.mintToken({ enrollmentProfileId: profile.id });
    const auth = await svc.authenticate(token);
    expect(auth).not.toBeNull();
    expect(auth.profile.id).toBe(profile.id);
  });

  test('falscher Token → null', async () => {
    expect(await svc.authenticate('enr_deadbeef')).toBeNull();
    expect(await svc.authenticate('')).toBeNull();
    expect(await svc.authenticate(null)).toBeNull();
  });

  test('revoked Token → null', async () => {
    const { token, enrollmentToken } = await svc.mintToken({ enrollmentProfileId: profile.id });
    await svc.revokeToken(enrollmentToken.id);
    expect(await svc.authenticate(token)).toBeNull();
  });

  test('expired Token → null', async () => {
    // Token mit Vergangenheits-Ablauf direkt einlagern (gleicher Hash, abgelaufen).
    const { token, domain } = EnrollmentToken.mint({ enrollmentProfileId: profile.id });
    const expired = new EnrollmentToken({
      id: domain.id, enrollmentProfileId: domain.enrollmentProfileId, tokenHash: domain.tokenHash,
      prefix: domain.prefix, expiresAt: new Date(Date.now() - 1000).toISOString(), revoked: false, createdAt: domain.createdAt,
    });
    await repo.createEnrollmentToken(expired);
    expect(await svc.authenticate(token)).toBeNull();
  });

  test('revoked EnrollmentProfile blockiert gültigen Token → null', async () => {
    const { token } = await svc.mintToken({ enrollmentProfileId: profile.id });
    await repo.transitionEnrollmentProfile(profile.id, 'revoked');
    expect(await svc.authenticate(token)).toBeNull();
  });
});

describe('EnrollmentTokenService — Secret Redaction (Token nie im Audit)', () => {
  test('Audit-Event enthält den Klartext-Token NICHT', async () => {
    const { token } = await svc.mintToken({ enrollmentProfileId: profile.id });
    const audit = await repo.listAudit({ subjectId: profile.id });
    const types = audit.data.map((e) => e.type);
    expect(types).toContain(AUDIT_EVENTS.ENROLLMENT_TOKEN_ISSUED);
    const dump = JSON.stringify(audit.data);
    expect(dump.includes(token)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);
  });
});
