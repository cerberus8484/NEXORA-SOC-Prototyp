'use strict';

// P_AGENT_1 — NodeEnrollmentService: Enroll, Heartbeat, Guards, No-Apply-Safety.
const { NodeEnrollmentService } = require('../../src/services/NodeEnrollmentService');
const { EnrollmentTokenService } = require('../../src/services/EnrollmentTokenService');
const { NodeCredentialService } = require('../../src/services/NodeCredentialService');
const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { AUDIT_EVENTS } = require('../../src/provisioning/provisioningDomain');

let repo; let tokenSvc; let credSvc; let svc; let profile; let token;
beforeEach(async () => {
  repo = new InMemoryProvisioningRepository();
  tokenSvc = new EnrollmentTokenService({ repo });
  credSvc = new NodeCredentialService({ repo });
  svc = new NodeEnrollmentService({ repo, tokenService: tokenSvc, credentialService: credSvc });
  profile = await repo.createEnrollmentProfile({ name: 'lab-sensor', role: 'normal_agent', capabilities: ['inventory', 'heartbeat'] });
  ({ token } = await tokenSvc.mintToken({ enrollmentProfileId: profile.id }));
});

// Frisches (Single-Use-)Enrollment-Token für Folge-Enrollments derselben Node.
async function freshToken() {
  return (await tokenSvc.mintToken({ enrollmentProfileId: profile.id })).token;
}

describe('NodeEnrollmentService — enroll', () => {
  test('gültiger Token → Node enrolled + Capabilities + Audit', async () => {
    const res = await svc.enroll({ token, hostname: 'dc01', platform: 'Windows', version: '1.0', ips: ['10.99.99.10'], capabilities: ['log_collection'] });
    expect(res).toHaveProperty('nodeId');
    expect(res).toHaveProperty('serverTime');

    const node = await repo.getNode(res.nodeId);
    expect(node.status).toBe('enrolled');
    expect(node.name).toBe('dc01');
    expect(node.ip).toBe('10.99.99.10');

    const caps = (await repo.listCapabilities(res.nodeId)).map((c) => c.name).sort();
    expect(caps).toEqual(['heartbeat', 'inventory', 'log_collection']); // Profil ∪ gemeldet, nur erlaubte

    const types = (await repo.listAudit({ subjectId: res.nodeId })).data.map((e) => e.type);
    expect(types).toContain(AUDIT_EVENTS.NODE_INSTALLED);
    expect(types).toContain(AUDIT_EVENTS.NODE_ENROLLED);
  });

  test('ungültiger Token → 401', async () => {
    await expect(svc.enroll({ token: 'enr_bad', hostname: 'dc01' })).rejects.toMatchObject({ statusCode: 401 });
  });

  test('revoked Profil blockiert Enrollment → 401', async () => {
    await repo.transitionEnrollmentProfile(profile.id, 'revoked');
    await expect(svc.enroll({ token, hostname: 'dc01' })).rejects.toMatchObject({ statusCode: 401 });
  });

  test('fehlender hostname → 400', async () => {
    await expect(svc.enroll({ token, hostname: '' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('zweites Enroll desselben hostname (frisches Token) aktualisiert, kein Duplikat', async () => {
    const a = await svc.enroll({ token, hostname: 'dc01', version: '1.0' });
    // Single-Use: das zweite Enrollment braucht ein neues Token.
    const b = await svc.enroll({ token: await freshToken(), hostname: 'dc01', version: '2.0' });
    expect(b.nodeId).toBe(a.nodeId);
    expect((await repo.listNodes({})).total).toBe(1);
    expect((await repo.getNode(b.nodeId)).version).toBe('2.0');
  });

  test('nur erlaubte Capabilities werden übernommen', async () => {
    const res = await svc.enroll({ token, hostname: 'dc01', capabilities: ['inventory', 'definitely_not_allowed'] });
    const caps = (await repo.listCapabilities(res.nodeId)).map((c) => c.name);
    expect(caps).toContain('inventory');
    expect(caps).not.toContain('definitely_not_allowed');
  });
});

describe('NodeEnrollmentService — heartbeat', () => {
  let nodeId;
  beforeEach(async () => {
    ({ nodeId } = await svc.enroll({ token, hostname: 'dc01', version: '1.0' }));
  });

  test('Heartbeat für unbekannte Node → 404', async () => {
    await expect(svc.recordHeartbeat('00000000-0000-0000-0000-000000000000', { status: 'healthy' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('gültiger Heartbeat → accepted true + serverTime, Node aktiv, lastSeen gesetzt', async () => {
    const res = await svc.recordHeartbeat(nodeId, { status: 'healthy', version: '2.0', ips: ['10.99.99.10'], capabilities: ['heartbeat'] });
    expect(res.accepted).toBe(true);
    expect(res).toHaveProperty('serverTime');

    const node = await repo.getNode(nodeId);
    expect(node.status).toBe('active'); // enrolled → active
    expect(node.lastSeenAt).not.toBeNull();
    expect(node.version).toBe('2.0');

    expect((await repo.latestHeartbeat(nodeId)).status).toBe('healthy');
    const types = (await repo.listAudit({ subjectId: nodeId })).data.map((e) => e.type);
    expect(types).toContain(AUDIT_EVENTS.HEARTBEAT_RECEIVED);
  });

  test('Heartbeat-Response liefert KEINE Commands/Apply-Felder', async () => {
    const res = await svc.recordHeartbeat(nodeId, { status: 'healthy' });
    const allowed = ['accepted', 'serverTime', 'desiredProfileId', 'policyVersion'];
    expect(Object.keys(res).every((k) => allowed.includes(k))).toBe(true);
    const dump = JSON.stringify(res);
    expect(dump).not.toMatch(/(command|apply|exec|ssh|remote|shell|firewall|nat|route|dhcp|sniff)/i);
  });
});

describe('NodeEnrollmentService — No-Apply-Safety', () => {
  test('keine Methode heißt apply/exec/ssh/network/nat/route/firewall/dhcp/sniff', () => {
    const forbidden = /(apply|exec|ssh|remote|shell|spawn|network|nat|route|routing|firewall|dhcp|sniff)/i;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    expect(methods.filter((m) => forbidden.test(m))).toEqual([]);
  });
});

describe('NodeEnrollmentService — registerInstalledNode (server-seitig, kein Token)', () => {
  test('neuer Node → angelegt, enrolled, mit Capabilities (ohne Enrollment-Token)', async () => {
    const node = await svc.registerInstalledNode({
      hostname: 'win-srv01', role: 'normal_agent', os: 'windows', ip: '10.0.10.50',
      capabilities: ['version_report', 'update_status'],
    });
    expect(node.name).toBe('win-srv01');
    expect(node.status).toBe('enrolled');
    expect(node.os).toBe('windows');
    expect(node.ip).toBe('10.0.10.50');
    const caps = (await repo.listCapabilities(node.id)).map((c) => c.name).sort();
    expect(caps).toEqual(['update_status', 'version_report']);
  });

  test('idempotent: zweite Registrierung desselben Namens upsertet (kein Duplikat), aktualisiert ip', async () => {
    const a = await svc.registerInstalledNode({ hostname: 'win-srv01', role: 'normal_agent', os: 'windows' });
    const b = await svc.registerInstalledNode({ hostname: 'win-srv01', role: 'normal_agent', os: 'windows', ip: '10.0.10.51' });
    expect(b.id).toBe(a.id);
    expect(b.ip).toBe('10.0.10.51');
  });

  test('hostname fehlt → ValidationError (400)', async () => {
    await expect(svc.registerInstalledNode({ role: 'normal_agent' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('hostKeyPin: wird gesetzt, wenn übergeben; ein bereits erfasster Pin wird nicht mit null überschrieben', async () => {
    const PIN = 'c'.repeat(64);
    const a = await svc.registerInstalledNode({ hostname: 'win-srv02', role: 'normal_agent', os: 'windows', hostKeyPin: PIN });
    expect(a.hostKeyPin).toBe(PIN);
    // Re-Registrierung OHNE Pin (z. B. Heartbeat-Refresh) darf den vorhandenen Pin behalten.
    const b = await svc.registerInstalledNode({ hostname: 'win-srv02', role: 'normal_agent', os: 'windows', ip: '10.0.10.60' });
    expect(b.hostKeyPin).toBe(PIN);
  });
});
