'use strict';

// Deployment Center — Phase 2: Joi-Body-Schemas für die Deploy-Routen.
// Grundform-Validierung (typisiert, keine freien Blobs). Die fachliche
// Params-Validierung gegen module.paramSchema macht der Service/die Domain.

const {
  createConnectorSchema, createSpecSchema, approveSchema, applySchema,
} = require('../../../src/domain/validation/deploySchema');

describe('createConnectorSchema', () => {
  const valid = {
    type: 'proxmox', name: 'Lab-PVE', host: '10.0.99.100',
    apiToken: 'root@pam!nexora=uuid', targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true,
  };

  test('akzeptiert gültigen Connector', () => {
    const { error, value } = createConnectorSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.type).toBe('proxmox');
  });

  test('verlangt Pflichtfelder', () => {
    expect(createConnectorSchema.validate({ ...valid, name: undefined }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...valid, host: undefined }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...valid, apiToken: undefined }).error).toBeTruthy();
  });

  test('verifyTls default true', () => {
    const { value } = createConnectorSchema.validate({ ...valid, verifyTls: undefined });
    expect(value.verifyTls).toBe(true);
  });

  test('strippt unbekannte Keys', () => {
    const { value } = createConnectorSchema.validate({ ...valid, hacker: 1 });
    expect(value).not.toHaveProperty('hacker');
  });

  test('host muss eine IPv4 sein (kein Hostname → kein DNS-Rebinding)', () => {
    expect(createConnectorSchema.validate({ ...valid, host: 'proxmox.lab' }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...valid, host: '10.0.99.100/24' }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...valid, host: '10.0.99.100' }).error).toBeUndefined();
  });
});

describe('createSpecSchema', () => {
  const valid = {
    moduleId: 'opnsense', connectorId: '11111111-1111-1111-1111-111111111111',
    targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1',
    resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
    params: { hostname: 'fw', ipMode: 'static' },
  };

  test('akzeptiert gültige Spec-Anlage', () => {
    const { error } = createSpecSchema.validate(valid);
    expect(error).toBeUndefined();
  });

  test('params muss ein Objekt sein (kein freier String)', () => {
    expect(createSpecSchema.validate({ ...valid, params: 'rm -rf /' }).error).toBeTruthy();
  });

  test('resources-Grenzen werden geprüft', () => {
    expect(createSpecSchema.validate({ ...valid, resources: { cpu: 0, ramMB: 2048, diskGB: 20 } }).error).toBeTruthy();
    expect(createSpecSchema.validate({ ...valid, resources: { cpu: 2, ramMB: 1, diskGB: 20 } }).error).toBeTruthy();
  });

  test('moduleId/connectorId Pflicht', () => {
    expect(createSpecSchema.validate({ ...valid, moduleId: undefined }).error).toBeTruthy();
    expect(createSpecSchema.validate({ ...valid, connectorId: undefined }).error).toBeTruthy();
  });
});

describe('approveSchema / applySchema — schlanke Bodies', () => {
  test('approve akzeptiert optionale note', () => {
    expect(approveSchema.validate({}).error).toBeUndefined();
    expect(approveSchema.validate({ note: 'sieht gut aus' }).error).toBeUndefined();
  });

  test('apply akzeptiert leeren Body (Reauth kommt per Header)', () => {
    expect(applySchema.validate({}).error).toBeUndefined();
  });

  test('apply strippt unbekannte Keys', () => {
    const { value } = applySchema.validate({ foo: 1 });
    expect(value).not.toHaveProperty('foo');
  });
});
