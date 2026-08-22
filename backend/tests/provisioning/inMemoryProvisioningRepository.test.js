'use strict';

const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { AUDIT_EVENTS } = require('../../src/provisioning/provisioningDomain');

let repo;
beforeEach(() => { repo = new InMemoryProvisioningRepository(); });

describe('P_PROVISION_1 Repo — ProvisioningProfile CRUD + Audit', () => {
  test('createProfile + getProfile + listProfiles({data,total})', async () => {
    const p = await repo.createProfile({ name: 'sensor-01', role: 'network_sensor' });
    expect(p.status).toBe('draft');
    expect(await repo.getProfile(p.id)).toMatchObject({ name: 'sensor-01' });
    const list = await repo.listProfiles({ limit: 10, offset: 0 });
    expect(list.total).toBe(1);
    expect(list.data).toHaveLength(1);
  });

  test('createProfile schreibt ein Audit-Event provisioning.profile.created', async () => {
    const p = await repo.createProfile({ name: 'x', role: 'normal_agent' });
    const audit = await repo.listAudit({ subjectId: p.id });
    expect(audit.data.map((e) => e.type)).toContain(AUDIT_EVENTS.PROFILE_CREATED);
  });

  test('transitionProfile validiert + auditiert (validated/approved)', async () => {
    let p = await repo.createProfile({ name: 'x', role: 'normal_agent' });
    p = await repo.transitionProfile(p.id, 'validated');
    expect(p.status).toBe('validated');
    p = await repo.transitionProfile(p.id, 'approved');
    expect(p.status).toBe('approved');
    const types = (await repo.listAudit({ subjectId: p.id })).data.map((e) => e.type);
    expect(types).toContain(AUDIT_EVENTS.PROFILE_VALIDATED);
    expect(types).toContain(AUDIT_EVENTS.PROFILE_APPROVED);
  });

  test('ungültige Transition wirft (draft → approved)', async () => {
    const p = await repo.createProfile({ name: 'x', role: 'normal_agent' });
    await expect(repo.transitionProfile(p.id, 'approved')).rejects.toThrow(/transition/i);
  });

  test('updateProfile ändert Felder, lässt status unangetastet', async () => {
    const p = await repo.createProfile({ name: 'x', role: 'normal_agent' });
    const u = await repo.updateProfile(p.id, { name: 'y' });
    expect(u.name).toBe('y'); expect(u.status).toBe('draft');
  });
});

describe('P_PROVISION_1 Repo — EnrollmentProfile', () => {
  test('create + list + revoke (audit enrollment.profile.revoked)', async () => {
    const e = await repo.createEnrollmentProfile({ name: 'lab-sensor', role: 'network_sensor', capabilities: ['inventory'] });
    expect(e.status).toBe('active');
    const r = await repo.transitionEnrollmentProfile(e.id, 'revoked');
    expect(r.status).toBe('revoked');
    const types = (await repo.listAudit({ subjectId: e.id })).data.map((x) => x.type);
    expect(types).toContain(AUDIT_EVENTS.ENROLLMENT_CREATED);
    expect(types).toContain(AUDIT_EVENTS.ENROLLMENT_REVOKED);
  });
});

describe('P_PROVISION_1 Repo — InstalledNode + Capabilities + Heartbeats', () => {
  test('createNode (installed) → transition enrolled (audit)', async () => {
    let n = await repo.createNode({ name: 'dc01', role: 'normal_agent' });
    expect(n.status).toBe('pending');
    n = await repo.transitionNode(n.id, 'enrolled');
    expect(n.status).toBe('enrolled');
    const types = (await repo.listAudit({ subjectId: n.id })).data.map((e) => e.type);
    expect(types).toContain(AUDIT_EVENTS.NODE_INSTALLED);
    expect(types).toContain(AUDIT_EVENTS.NODE_ENROLLED);
  });

  test('reportCapability + listCapabilities(nodeId)', async () => {
    const n = await repo.createNode({ name: 'dc01', role: 'normal_agent' });
    await repo.reportCapability({ nodeId: n.id, name: 'inventory' });
    await repo.reportCapability({ nodeId: n.id, name: 'log_collection' });
    const caps = await repo.listCapabilities(n.id);
    expect(caps.map((c) => c.name).sort()).toEqual(['inventory', 'log_collection']);
  });

  test('recordHeartbeat + listHeartbeats + latestHeartbeat', async () => {
    const n = await repo.createNode({ name: 'dc01', role: 'normal_agent' });
    await repo.recordHeartbeat({ nodeId: n.id, status: 'healthy' });
    await repo.recordHeartbeat({ nodeId: n.id, status: 'degraded' });
    const hb = await repo.listHeartbeats(n.id);
    expect(hb).toHaveLength(2);
    expect((await repo.latestHeartbeat(n.id)).status).toBe('degraded');
    expect((await repo.listAudit({ subjectId: n.id })).data.map((e) => e.type)).toContain(AUDIT_EVENTS.HEARTBEAT_RECEIVED);
  });
});

describe('P_PROVISION_1 Repo — findNodesByIp (ADR-042 Containment-Lookup, ambiguitäts-bewusst)', () => {
  test('findet Node(s) über IP; unbekannte/leere IP → leeres Array', async () => {
    await repo.createNode({ name: 'web01', role: 'normal_agent', ip: '10.0.10.80' });
    const found = await repo.findNodesByIp('10.0.10.80');
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('web01');
    expect(await repo.findNodesByIp('10.0.10.99')).toEqual([]);
    expect(await repo.findNodesByIp('')).toEqual([]);
    expect(await repo.findNodesByIp(null)).toEqual([]);
  });

  test('mehrere Records je IP → ALLE (newest-first) für die Ambiguitäts-Policy des Aufrufers', async () => {
    await repo.createNode({ name: 'old', role: 'normal_agent', ip: '10.0.10.80' });
    await new Promise((r) => setTimeout(r, 2)); // createdAt-Abstand erzwingen
    await repo.createNode({ name: 'new', role: 'normal_agent', ip: '10.0.10.80' });
    const found = await repo.findNodesByIp('10.0.10.80');
    expect(found).toHaveLength(2);
    expect(found[0].name).toBe('new'); // newest zuerst
  });

  test('sshUser wird persistiert + über findNodesByIp gelesen (ADR-042 Containment-User)', async () => {
    await repo.createNode({ name: 'win01', role: 'normal_agent', ip: '10.0.10.81', os: 'Windows', sshUser: 'DOMAIN\\svc-ir' });
    expect((await repo.findNodesByIp('10.0.10.81'))[0].sshUser).toBe('DOMAIN\\svc-ir');
    // Default null, wenn nicht gesetzt.
    await repo.createNode({ name: 'lin01', role: 'normal_agent', ip: '10.0.10.82' });
    expect((await repo.findNodesByIp('10.0.10.82'))[0].sshUser).toBeNull();
  });
});

describe('P_PROVISION_1 Repo — Audit append-only + Filter', () => {
  test('appendAudit + listAudit (Filter type), {data,total}', async () => {
    await repo.appendAudit({ type: AUDIT_EVENTS.PLAN_GENERATED, subjectType: 'profile', subjectId: 'p1' });
    await repo.appendAudit({ type: AUDIT_EVENTS.APPLY_BLOCKED, subjectType: 'node', subjectId: 'n1' });
    const all = await repo.listAudit({});
    expect(all.total).toBeGreaterThanOrEqual(2);
    const blocked = await repo.listAudit({ type: AUDIT_EVENTS.APPLY_BLOCKED });
    expect(blocked.data.every((e) => e.type === AUDIT_EVENTS.APPLY_BLOCKED)).toBe(true);
  });

  test('Audit hat KEINE update/delete-Methode (append-only)', () => {
    expect(repo.updateAudit).toBeUndefined();
    expect(repo.deleteAudit).toBeUndefined();
  });

  test('Secret in appendAudit-data wird abgelehnt', async () => {
    await expect(repo.appendAudit({ type: AUDIT_EVENTS.NODE_ENROLLED, subjectType: 'node', data: { token: 'eyJ...' } })).rejects.toThrow(/secret|token/i);
  });
});

describe('P_PROVISION_1 Repo — No-Apply-Safety', () => {
  test('Repo hat keine apply/exec/ssh/network/nat/route/firewall/dhcp-Methode', () => {
    const forbidden = /(apply|exec|ssh|remote|shell|spawn|network|nat|route|routing|firewall|dhcp|sniff)/i;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
    expect(methods.filter((m) => forbidden.test(m))).toEqual([]);
  });
});
