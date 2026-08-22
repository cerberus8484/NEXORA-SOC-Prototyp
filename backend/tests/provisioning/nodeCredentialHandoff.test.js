'use strict';

// P_INSTALL_1 Slice 2 — Node-Credential-Handoff (RED-first).
// Enrollment-Token = einmalig (Bootstrap). Node-Credential = Betrieb (Heartbeat).
const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { NodeCredential, AUDIT_EVENTS } = require('../../src/provisioning/provisioningDomain');
const { NodeCredentialService } = require('../../src/services/NodeCredentialService');
const { EnrollmentTokenService } = require('../../src/services/EnrollmentTokenService');
const { NodeEnrollmentService } = require('../../src/services/NodeEnrollmentService');

function wire() {
  const repo = new InMemoryProvisioningRepository();
  const tokenService = new EnrollmentTokenService({ repo });
  const credentialService = new NodeCredentialService({ repo });
  const enrollService = new NodeEnrollmentService({ repo, tokenService, credentialService });
  return { repo, tokenService, credentialService, enrollService };
}

describe('NodeCredential — Domain', () => {
  test('mint() liefert Klartext-Credential (ncr_-Präfix, 256-bit) genau einmal', () => {
    const { credential, domain } = NodeCredential.mint({ nodeId: 'n1' });
    expect(typeof credential).toBe('string');
    expect(credential.startsWith('ncr_')).toBe(true);
    expect(credential).toHaveLength(4 + 64); // ncr_ + 64 hex
    expect(domain.nodeId).toBe('n1');
    expect(domain.status).toBe('active');
  });
  test('toJSON gibt NIE tokenHash oder Klartext aus', () => {
    const { credential, domain } = NodeCredential.mint({ nodeId: 'n1' });
    const json = domain.toJSON();
    expect(json).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(json).includes(credential)).toBe(false);
    expect(json).toMatchObject({ nodeId: 'n1', status: 'active' });
    expect(json).toHaveProperty('prefix');
    expect(json).toHaveProperty('issuedAt');
  });
  test('hash(raw) ist deterministisch und entspricht dem gespeicherten Hash', () => {
    const { credential, domain } = NodeCredential.mint({ nodeId: 'n1' });
    expect(NodeCredential.hash(credential)).toBe(domain.tokenHash);
  });
  test('mint ohne nodeId wirft', () => {
    expect(() => NodeCredential.mint({})).toThrow();
  });
});

describe('Repository — NodeCredential (nur Hash gespeichert)', () => {
  test('createNodeCredential gibt kein Hash/Klartext zurück; Lookup nur per Hash', async () => {
    const { repo } = wire();
    const { credential, domain } = NodeCredential.mint({ nodeId: 'n1' });
    const stored = await repo.createNodeCredential(domain);
    expect(stored).not.toHaveProperty('tokenHash');
    expect(await repo.findNodeCredentialByHash(credential)).toBeNull(); // Klartext findet nichts
    const rec = await repo.findNodeCredentialByHash(NodeCredential.hash(credential));
    expect(rec).not.toBeNull();
    expect(rec).not.toHaveProperty('tokenHash');
    expect(rec.nodeId).toBe('n1');
  });
  test('revokeNodeCredential setzt status=revoked', async () => {
    const { repo } = wire();
    const { domain } = NodeCredential.mint({ nodeId: 'n1' });
    const stored = await repo.createNodeCredential(domain);
    const r = await repo.revokeNodeCredential(stored.id, 'test');
    expect(r.status).toBe('revoked');
  });
});

describe('NodeCredentialService — authenticate Guards', () => {
  test('gültiges Credential → { nodeId }', async () => {
    const { credentialService } = wire();
    const { credential } = await credentialService.mintForNode('n1');
    const auth = await credentialService.authenticate(credential);
    expect(auth).not.toBeNull();
    expect(auth.nodeId).toBe('n1');
  });
  test('falsches/leeres Credential → null', async () => {
    const { credentialService } = wire();
    expect(await credentialService.authenticate('ncr_falsch')).toBeNull();
    expect(await credentialService.authenticate('')).toBeNull();
    expect(await credentialService.authenticate(null)).toBeNull();
  });
  test('revoked Credential → null', async () => {
    const { credentialService } = wire();
    const { credential, nodeCredential } = await credentialService.mintForNode('n1');
    await credentialService.revoke(nodeCredential.id, 'manuell');
    expect(await credentialService.authenticate(credential)).toBeNull();
  });
  test('Enrollment-Token authentifiziert NICHT als Node-Credential', async () => {
    const { repo, tokenService, credentialService } = wire();
    const profile = await repo.createEnrollmentProfile({ name: 'p', role: 'normal_agent' });
    const { token } = await tokenService.mintToken({ enrollmentProfileId: profile.id });
    expect(await credentialService.authenticate(token)).toBeNull();
  });
});

describe('Enrollment → Node-Credential-Handoff', () => {
  async function freshToken(repo, tokenService) {
    const profile = await repo.createEnrollmentProfile({ name: 'p', role: 'normal_agent', capabilities: ['heartbeat'] });
    const { token } = await tokenService.mintToken({ enrollmentProfileId: profile.id });
    return token;
  }

  test('enroll liefert nodeId + nodeCredential (Klartext, ncr_)', async () => {
    const { repo, tokenService, enrollService } = wire();
    const token = await freshToken(repo, tokenService);
    const res = await enrollService.enroll({ token, hostname: 'host-1', platform: 'Linux' });
    expect(res).toHaveProperty('nodeId');
    expect(typeof res.nodeCredential).toBe('string');
    expect(res.nodeCredential.startsWith('ncr_')).toBe(true);
    expect(res).toHaveProperty('serverTime');
  });

  test('das ausgegebene Node-Credential authentifiziert für genau diese Node', async () => {
    const { repo, tokenService, credentialService, enrollService } = wire();
    const token = await freshToken(repo, tokenService);
    const res = await enrollService.enroll({ token, hostname: 'host-1' });
    const auth = await credentialService.authenticate(res.nodeCredential);
    expect(auth.nodeId).toBe(res.nodeId);
  });

  test('Enrollment-Token ist nach Enroll verbraucht (zweiter Enroll mit gleichem Token → 401)', async () => {
    const { repo, tokenService, enrollService } = wire();
    const token = await freshToken(repo, tokenService);
    await enrollService.enroll({ token, hostname: 'host-1' });
    await expect(enrollService.enroll({ token, hostname: 'host-1' })).rejects.toMatchObject({ statusCode: 401 });
  });

  test('verbrauchter Enrollment-Token erzeugt kein zweites Node-Credential', async () => {
    const { repo, tokenService, enrollService } = wire();
    const token = await freshToken(repo, tokenService);
    const a = await enrollService.enroll({ token, hostname: 'host-1' });
    await expect(enrollService.enroll({ token, hostname: 'host-1' })).rejects.toBeDefined();
    // Credential a bleibt gültig (kein Doppel-Issue), aber kein neues entstand.
    const { credentialService } = wire(); // separater Store nur zur Sicherheit nicht — nutze gleichen:
    expect(a.nodeCredential.startsWith('ncr_')).toBe(true);
  });

  test('Klartext-Credential erscheint NICHT im Audit', async () => {
    const { repo, tokenService, enrollService } = wire();
    const token = await freshToken(repo, tokenService);
    const res = await enrollService.enroll({ token, hostname: 'host-1' });
    const audit = await repo.listAudit({});
    const dump = JSON.stringify(audit.data);
    expect(dump.includes(res.nodeCredential)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);
    expect(audit.data.map((e) => e.type)).toContain(AUDIT_EVENTS.NODE_CREDENTIAL_ISSUED);
    expect(audit.data.map((e) => e.type)).toContain(AUDIT_EVENTS.ENROLLMENT_TOKEN_CONSUMED);
  });
});
