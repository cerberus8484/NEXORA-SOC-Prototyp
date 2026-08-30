'use strict';

// Deployment Center — Phase 1: Hypervisor-Connector-Typ-Katalog (Code-Allowlist).
// Nur bekannte Connector-Typen sind zulässig. Schnitt #1: nur 'proxmox'.

const {
  listConnectorTypes, getConnectorType, ConnectorTypeDefinition,
} = require('../../src/deploy/hypervisorConnectorCatalog');

describe('hypervisorConnectorCatalog — Allowlist', () => {
  test('listConnectorTypes enthält proxmox', () => {
    const ids = listConnectorTypes().map((c) => c.id);
    expect(ids).toContain('proxmox');
  });

  test('getConnectorType("proxmox") liefert Vertragsbeschreibung', () => {
    const c = getConnectorType('proxmox');
    expect(c).toBeInstanceOf(ConnectorTypeDefinition);
    expect(c.id).toBe('proxmox');
    expect(c.name).toBeTruthy();
    expect(Array.isArray(c.operations)).toBe(true);
    // Der Connector-Vertrag (§2.2 Architektur) — mindestens diese Operationen.
    for (const op of ['cloneFromTemplate', 'setResources', 'attachNetwork', 'start', 'status', 'destroy', 'checkPreconditions']) {
      expect(c.operations).toContain(op);
    }
  });

  test('Schnitt #1 kennt NUR proxmox', () => {
    expect(listConnectorTypes()).toHaveLength(1);
  });

  test('unbekannter Connector-Typ → Fehler mit Status 404', () => {
    expect(() => getConnectorType('esxi')).toThrow();
    try {
      getConnectorType('esxi');
    } catch (e) {
      expect(e.status || e.statusCode).toBe(404);
    }
  });
});
