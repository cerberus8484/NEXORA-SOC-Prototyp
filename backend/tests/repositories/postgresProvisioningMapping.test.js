'use strict';

// P_PROVISION_2 — Mapping + Methoden-Vertrag (ohne DB, wie postgres*Mapping.test.js).
const { PostgresProvisioningRepository } = require('../../src/repositories/PostgresProvisioningRepository');
const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');

const repo = new PostgresProvisioningRepository();
const T = new Date('2026-06-17T20:00:00.000Z');

describe('PostgresProvisioningRepository — row → domain mapping (snake → camel, jsonb)', () => {
  test('_toProfile', () => {
    expect(repo._toProfile({ id: 'p1', name: 'sensor-01', role: 'network_sensor', labels: { env: 'lab' }, status: 'draft', created_by: 'admin', created_at: T, updated_at: T }))
      .toEqual({ id: 'p1', name: 'sensor-01', role: 'network_sensor', labels: { env: 'lab' }, status: 'draft', createdBy: 'admin', createdAt: T.toISOString(), updatedAt: T.toISOString() });
  });
  test('_toEnrollment (capabilities jsonb-Array)', () => {
    expect(repo._toEnrollment({ id: 'e1', name: 'lab-sensor', role: 'network_sensor', capabilities: ['inventory', 'syslog_receiver'], expires_at: null, status: 'active', created_at: T, updated_at: T }))
      .toEqual({ id: 'e1', name: 'lab-sensor', role: 'network_sensor', capabilities: ['inventory', 'syslog_receiver'], expiresAt: null, status: 'active', createdAt: T.toISOString(), updatedAt: T.toISOString() });
  });
  test('_toNode', () => {
    const pin = 'a'.repeat(64);
    expect(repo._toNode({ id: 'n1', name: 'dc01', role: 'normal_agent', profile_id: 'p1', fqdn: 'dc01.nexora.example', ip: '10.99.99.10', os: 'Windows', version: '1.0', status: 'enrolled', last_seen_at: T, host_key_pin: pin, ssh_user: 'DOMAIN\\svc-ir', created_at: T, updated_at: T }))
      .toEqual({ id: 'n1', name: 'dc01', role: 'normal_agent', profileId: 'p1', fqdn: 'dc01.nexora.example', ip: '10.99.99.10', os: 'Windows', version: '1.0', status: 'enrolled', lastSeenAt: T.toISOString(), hostKeyPin: pin, sshUser: 'DOMAIN\\svc-ir', createdAt: T.toISOString(), updatedAt: T.toISOString() });
    // host_key_pin NULL → hostKeyPin: null
    expect(repo._toNode({ id: 'n2', name: 'x', role: 'normal_agent', status: 'pending', created_at: T, updated_at: T }).hostKeyPin).toBeNull();
  });
  test('_toCapability (detail jsonb)', () => {
    expect(repo._toCapability({ id: 'c1', node_id: 'n1', name: 'inventory', detail: { items: 12 }, reported_at: T }))
      .toEqual({ id: 'c1', nodeId: 'n1', name: 'inventory', detail: { items: 12 }, reportedAt: T.toISOString() });
  });
  test('_toHeartbeat', () => {
    expect(repo._toHeartbeat({ id: 'h1', node_id: 'n1', status: 'healthy', agent_version: '1.2', note: null, received_at: T }))
      .toEqual({ id: 'h1', nodeId: 'n1', status: 'healthy', agentVersion: '1.2', note: null, receivedAt: T.toISOString() });
  });
  test('_toAudit (data jsonb; String wird geparst)', () => {
    expect(repo._toAudit({ id: 'a1', type: 'node.enrolled', actor: 'admin', subject_type: 'node', subject_id: 'n1', data: '{"x":1}', at: T }))
      .toEqual({ id: 'a1', type: 'node.enrolled', actor: 'admin', subjectType: 'node', subjectId: 'n1', data: { x: 1 }, at: T.toISOString() });
  });
  test('_toEnrollmentToken (kein token_hash nach außen)', () => {
    const out = repo._toEnrollmentToken({ id: 't1', enrollment_profile_id: 'e1', token_hash: 'deadbeef', prefix: 'enr_1234...', expires_at: T, revoked: false, created_at: T });
    expect(out).toEqual({ id: 't1', enrollmentProfileId: 'e1', prefix: 'enr_1234...', expiresAt: T.toISOString(), revoked: false, createdAt: T.toISOString() });
    expect(out).not.toHaveProperty('tokenHash');
    expect(out).not.toHaveProperty('token_hash');
  });
  test('_toNodeCredential (kein token_hash nach außen)', () => {
    const out = repo._toNodeCredential({ id: 'c1', node_id: 'n1', token_hash: 'deadbeef', prefix: 'ncr_1234...', status: 'active', issued_at: T, last_used_at: null, revoked_at: null, revoked_reason: null });
    expect(out).toEqual({ id: 'c1', nodeId: 'n1', prefix: 'ncr_1234...', status: 'active', issuedAt: T.toISOString(), lastUsedAt: null, revokedAt: null, revokedReason: null });
    expect(out).not.toHaveProperty('tokenHash');
    expect(out).not.toHaveProperty('token_hash');
  });
});

describe('PostgresProvisioningRepository — Methoden-Vertrag = InMemory', () => {
  test('gleiche öffentliche Methoden wie InMemoryProvisioningRepository', () => {
    const publicMethods = (obj) => Object.getOwnPropertyNames(Object.getPrototypeOf(obj))
      .filter((m) => m !== 'constructor' && !m.startsWith('_') && typeof obj[m] === 'function')
      .sort();
    const inmem = publicMethods(new InMemoryProvisioningRepository());
    const pg    = publicMethods(repo);
    expect(pg).toEqual(inmem);
  });

  test('No-Apply-Safety: keine apply/exec/network/nat/route/firewall/dhcp-Methode', () => {
    const forbidden = /(apply|exec|ssh|remote|shell|spawn|network|nat|route|routing|firewall|dhcp|sniff)/i;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
    expect(methods.filter((m) => forbidden.test(m))).toEqual([]);
  });
});
