'use strict';

// Deployment Center — Phase 1: Hypervisor-Connector-Domain.
// Ein Connector hält Zugangsdaten zu EINEM Hypervisor. Der API-Token wird
// AES-256-GCM verschlüsselt at-rest gehalten und erscheint NIE im toJSON/Log/Return.

const { HypervisorConnector } = require('../../src/deploy/hypervisorConnectorDomain');
const { isEncrypted } = require('../../src/config/secretsCrypto');

function validConnectorInput(overrides = {}) {
  return {
    type: 'proxmox',
    name: 'Lab-Proxmox',
    host: '10.0.99.100',
    apiToken: 'root@pam!nexora=11112222-3333-4444-5555-666677778888',
    targetNode: 'pve1',
    storage: 'local-lvm',
    bridge: 'vmbr1',
    verifyTls: true,
    createdBy: 'admin',
    ...overrides,
  };
}

describe('HypervisorConnector — create + Secret-Handling', () => {
  test('create verschlüsselt den API-Token (kein Klartext gespeichert)', () => {
    const c = HypervisorConnector.create(validConnectorInput());
    expect(c.apiTokenEnc).toBeTruthy();
    expect(isEncrypted(c.apiTokenEnc)).toBe(true);
    expect(c.apiTokenEnc).not.toContain('11112222');   // Secret-Teil des Tokens
  });

  test('getApiToken entschlüsselt den Original-Token round-trip', () => {
    const c = HypervisorConnector.create(validConnectorInput());
    expect(c.getApiToken()).toBe(validConnectorInput().apiToken);
  });

  test('toJSON zeigt NIE Token oder Klartext-Secret', () => {
    const c = HypervisorConnector.create(validConnectorInput());
    const json = c.toJSON();
    expect(json).not.toHaveProperty('apiToken');
    expect(json).not.toHaveProperty('apiTokenEnc');
    const s = JSON.stringify(json);
    expect(s).not.toContain('11112222');
    expect(s).not.toMatch(/enc:v1:/);
  });

  test('toJSON zeigt einen nicht-geheimen Hinweis (prefix) zur Identifikation', () => {
    const c = HypervisorConnector.create(validConnectorInput());
    const json = c.toJSON();
    expect(json.prefix).toBeTruthy();
    expect(json.prefix).not.toContain('11112222');     // kein Secret-Teil im Hinweis
    expect(json).toMatchObject({ type: 'proxmox', name: 'Lab-Proxmox', host: '10.0.99.100', targetNode: 'pve1' });
  });

  test('wirft bei fehlenden Pflichtfeldern', () => {
    expect(() => HypervisorConnector.create(validConnectorInput({ name: '' }))).toThrow(/name/);
    expect(() => HypervisorConnector.create(validConnectorInput({ host: '' }))).toThrow(/host/);
    expect(() => HypervisorConnector.create(validConnectorInput({ apiToken: '' }))).toThrow(/token/i);
  });

  test('wirft bei unbekanntem Connector-Typ (Allowlist)', () => {
    expect(() => HypervisorConnector.create(validConnectorInput({ type: 'esxi' }))).toThrow();
  });

  test('verifyTls default true (fail-safe), explizit false möglich', () => {
    expect(HypervisorConnector.create(validConnectorInput({ verifyTls: undefined })).verifyTls).toBe(true);
    expect(HypervisorConnector.create(validConnectorInput({ verifyTls: false })).verifyTls).toBe(false);
  });
});
