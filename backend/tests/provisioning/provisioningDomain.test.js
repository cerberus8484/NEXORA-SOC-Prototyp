'use strict';

// P_PROVISION_1 — Tests für das Provisioning-Domain-Model (rein, kein Apply/Netz).
const D = require('../../src/provisioning/provisioningDomain');
const {
  ProvisioningProfile, EnrollmentProfile, InstalledNode,
  NodeCapability, NodeHeartbeat, ProvisioningAuditEvent,
  PROFILE_STATUS, NODE_STATUS, ENROLLMENT_STATUS, HEARTBEAT_STATUS,
  CAPABILITIES, AUDIT_EVENTS,
} = D;

describe('P_PROVISION_1 — ProvisioningProfile', () => {
  test('create: gültiges Profil (draft), mit Timestamps + id', () => {
    const p = ProvisioningProfile.create({ name: 'sensor-01', role: 'network_sensor', labels: { env: 'lab' } });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.status).toBe('draft');
    expect(p.name).toBe('sensor-01');
    expect(p.role).toBe('network_sensor');
    expect(p.createdAt).toBeTruthy();
  });

  test('create: unbekannte role → Fehler 400', () => {
    expect(() => ProvisioningProfile.create({ name: 'x', role: 'super_admin' })).toThrow(/role/i);
  });

  test('create: fehlender name → Fehler', () => {
    expect(() => ProvisioningProfile.create({ role: 'normal_agent' })).toThrow(/name/i);
  });

  test('Secret im labels → Fehler (keine Klartext-Secrets im Modell)', () => {
    expect(() => ProvisioningProfile.create({ name: 'x', role: 'normal_agent', labels: { apiToken: 'eyJ...' } })).toThrow(/secret|token/i);
  });

  test('status transition: draft → validated → approved → retired', () => {
    let p = ProvisioningProfile.create({ name: 'x', role: 'normal_agent' });
    p = p.transitionTo('validated'); expect(p.status).toBe('validated');
    p = p.transitionTo('approved');  expect(p.status).toBe('approved');
    p = p.transitionTo('retired');   expect(p.status).toBe('retired');
  });

  test('invalid transition: draft → approved blockiert', () => {
    const p = ProvisioningProfile.create({ name: 'x', role: 'normal_agent' });
    expect(() => p.transitionTo('approved')).toThrow(/transition/i);
  });

  test('invalid transition: retired → active blockiert', () => {
    const p = ProvisioningProfile.create({ name: 'x', role: 'normal_agent' }).transitionTo('validated').transitionTo('approved').transitionTo('retired');
    expect(() => p.transitionTo('validated')).toThrow(/transition/i);
  });

  test('update ist immutabel — Original unverändert', () => {
    const p = ProvisioningProfile.create({ name: 'x', role: 'normal_agent' });
    const p2 = p.update({ name: 'y' });
    expect(p.name).toBe('x');
    expect(p2.name).toBe('y');
  });
});

describe('P_PROVISION_1 — EnrollmentProfile (kein Token im Modell)', () => {
  test('create: active; speichert KEIN token (nur Referenz/Capabilities)', () => {
    const e = EnrollmentProfile.create({ name: 'lab-sensor', role: 'network_sensor', capabilities: ['inventory', 'syslog_receiver'] });
    expect(e.status).toBe('active');
    expect(JSON.stringify(e.toJSON())).not.toMatch(/token|secret/i);
  });
  test('create: token-Feld wird abgelehnt (Secret)', () => {
    expect(() => EnrollmentProfile.create({ name: 'x', role: 'normal_agent', token: 'eyJ...' })).toThrow(/secret|token/i);
  });
  test('unbekannte capability → Fehler', () => {
    expect(() => EnrollmentProfile.create({ name: 'x', role: 'normal_agent', capabilities: ['hack_firewall'] })).toThrow(/capabilit/i);
  });
  test('transition active → revoked; revoked → active blockiert', () => {
    const e = EnrollmentProfile.create({ name: 'x', role: 'normal_agent' });
    const r = e.transitionTo('revoked'); expect(r.status).toBe('revoked');
    expect(() => r.transitionTo('active')).toThrow(/transition/i);
  });
});

describe('P_PROVISION_1 — InstalledNode', () => {
  test('create: pending; valide role', () => {
    const n = InstalledNode.create({ name: 'dc01', role: 'normal_agent' });
    expect(n.status).toBe('pending');
  });
  test('lifecycle: pending → enrolled → active → stale → active → retired', () => {
    let n = InstalledNode.create({ name: 'dc01', role: 'normal_agent' });
    n = n.transitionTo('enrolled'); n = n.transitionTo('active'); n = n.transitionTo('stale');
    n = n.transitionTo('active');   n = n.transitionTo('retired');
    expect(n.status).toBe('retired');
  });
  test('invalid: pending → active blockiert', () => {
    const n = InstalledNode.create({ name: 'x', role: 'normal_agent' });
    expect(() => n.transitionTo('active')).toThrow(/transition/i);
  });
  test('hostKeyPin: default null; gültiger SHA-256-Hex akzeptiert (normalisiert); ungültig abgelehnt', () => {
    expect(InstalledNode.create({ name: 'x', role: 'normal_agent' }).hostKeyPin).toBeNull();
    const PIN = 'A'.repeat(64);
    expect(InstalledNode.create({ name: 'x', role: 'normal_agent', hostKeyPin: PIN }).hostKeyPin).toBe('a'.repeat(64));
    expect(() => InstalledNode.create({ name: 'x', role: 'normal_agent', hostKeyPin: 'zzz' })).toThrow(/host_key_pin/);
  });
  test('update kann hostKeyPin setzen (post-Boot-Capture); ungültig wirft', () => {
    const n = InstalledNode.create({ name: 'x', role: 'normal_agent' });
    const pinned = n.update({ hostKeyPin: 'b'.repeat(64) });
    expect(pinned.hostKeyPin).toBe('b'.repeat(64));
    expect(() => n.update({ hostKeyPin: 'nope' })).toThrow(/host_key_pin/);
  });
});

describe('P_PROVISION_1 — NodeCapability (read-only Report)', () => {
  test('create: erlaubte capability', () => {
    const c = NodeCapability.create({ nodeId: 'n1', name: 'inventory' });
    expect(c.name).toBe('inventory');
    expect(c.nodeId).toBe('n1');
  });
  test('unbekannte capability → Fehler', () => {
    expect(() => NodeCapability.create({ nodeId: 'n1', name: 'change_firewall' })).toThrow(/capabilit/i);
  });
});

describe('P_PROVISION_1 — NodeHeartbeat', () => {
  test('create: status healthy/degraded/offline ok', () => {
    for (const s of HEARTBEAT_STATUS) {
      expect(NodeHeartbeat.create({ nodeId: 'n1', status: s }).status).toBe(s);
    }
  });
  test('ungültiger status → Fehler', () => {
    expect(() => NodeHeartbeat.create({ nodeId: 'n1', status: 'on_fire' })).toThrow(/status/i);
  });
});

describe('P_PROVISION_1 — ProvisioningAuditEvent (append-only, redacted)', () => {
  test('create: gültiger event-type', () => {
    const ev = ProvisioningAuditEvent.create({ type: AUDIT_EVENTS.PROFILE_CREATED, subjectType: 'profile', subjectId: 'p1', actor: 'admin' });
    expect(ev.type).toBe('provisioning.profile.created');
    expect(ev.at).toBeTruthy();
  });
  test('unbekannter event-type → Fehler', () => {
    expect(() => ProvisioningAuditEvent.create({ type: 'something.random', subjectType: 'x' })).toThrow(/type/i);
  });
  test('Secret in data → Fehler (keine Tokens loggen)', () => {
    expect(() => ProvisioningAuditEvent.create({ type: AUDIT_EVENTS.NODE_ENROLLED, subjectType: 'node', data: { enrollmentToken: 'eyJ...' } })).toThrow(/secret|token/i);
  });
  test('hat KEINE update/delete-Methode (append-only)', () => {
    const ev = ProvisioningAuditEvent.create({ type: AUDIT_EVENTS.PLAN_GENERATED, subjectType: 'profile' });
    expect(ev.update).toBeUndefined();
    expect(ev.delete).toBeUndefined();
  });
});

describe('P_PROVISION_1 — No-Apply-Safety (Modell ändert nie Netzwerk/Remote)', () => {
  test('keine Entity hat eine apply/exec/ssh/network/nat/route/firewall/dhcp-Methode', () => {
    const forbidden = /(apply|exec|ssh|remote|shell|spawn|network|nat|route|routing|firewall|dhcp|sniff)/i;
    for (const Cls of [ProvisioningProfile, EnrollmentProfile, InstalledNode, NodeCapability, NodeHeartbeat, ProvisioningAuditEvent]) {
      const methods = Object.getOwnPropertyNames(Cls.prototype).concat(Object.getOwnPropertyNames(Cls));
      const bad = methods.filter((m) => forbidden.test(m));
      expect(bad).toEqual([]);
    }
  });
  test('AUDIT_EVENTS enthält apply.blocked als reines Audit-Konzept (kein Apply-Pfad)', () => {
    expect(AUDIT_EVENTS.APPLY_BLOCKED).toBe('provisioning.apply.blocked');
  });
  test('Status-Enums vollständig', () => {
    expect(PROFILE_STATUS).toEqual(['draft', 'validated', 'approved', 'retired']);
    expect(ENROLLMENT_STATUS).toEqual(['active', 'expired', 'revoked']);
    expect(NODE_STATUS).toEqual(['pending', 'enrolled', 'active', 'stale', 'retired']);
    expect(HEARTBEAT_STATUS).toEqual(['healthy', 'degraded', 'offline']);
    expect(CAPABILITIES).toContain('inventory');
  });
});
