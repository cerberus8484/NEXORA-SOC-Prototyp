'use strict';

// ManualHost — Domänenobjekt für manuell gepflegte Assets (Nicht-Wazuh-Quelle).

const { ManualHost } = require('../../src/domain/ManualHost');

describe('ManualHost — Erzeugung', () => {
  test('create vergibt id, source=manual und Zeitstempel', () => {
    const h = ManualHost.create({ hostname: 'fw-edge', createdBy: 'admin@x.io' });
    expect(h.id).toMatch(/[0-9a-f-]{36}/);
    expect(h.source).toBe('manual');
    expect(h.hostname).toBe('fw-edge');
    expect(h.createdBy).toBe('admin@x.io');
    expect(typeof h.createdAt).toBe('string');
    expect(typeof h.updatedAt).toBe('string');
  });

  test('ipAddresses default = leeres Array', () => {
    const h = ManualHost.create({ hostname: 'sw01' });
    expect(Array.isArray(h.ipAddresses)).toBe(true);
    expect(h.ipAddresses).toHaveLength(0);
  });

  test('übernommene Felder + toJSON round-trip', () => {
    const h = ManualHost.create({
      hostname: 'nas01', ipAddresses: ['10.0.10.5'], os: 'TrueNAS', customer: 'ACME', notes: 'Storage',
    });
    const j = h.toJSON();
    expect(j).toMatchObject({
      hostname: 'nas01', ipAddresses: ['10.0.10.5'], os: 'TrueNAS', customer: 'ACME', notes: 'Storage', source: 'manual',
    });
  });
});
