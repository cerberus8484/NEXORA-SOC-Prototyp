'use strict';

// Deployment Center — Phase 1: System-Modul-Katalog (Code-Allowlist).
// Nur exakt gelistete System-Module sind deploybar. Unbekannt = deny.
// Schnitt #1 kennt genau ein Modul: OPNsense.

const {
  listModules, getModule, ModuleDefinition,
} = require('../../src/deploy/deployModuleCatalog');

describe('deployModuleCatalog — Allowlist', () => {
  test('listModules liefert mindestens OPNsense', () => {
    const ids = listModules().map((m) => m.id);
    expect(ids).toContain('opnsense');
  });

  test('getModule("opnsense") liefert vollständige Definition', () => {
    const m = getModule('opnsense');
    expect(m).toBeInstanceOf(ModuleDefinition);
    expect(m.id).toBe('opnsense');
    expect(m.type).toBe('firewall');
    expect(m.vendor).toBeTruthy();
    expect(m.templateRefField).toBeTruthy();       // wie die Golden-Template-Referenz heißt
    expect(m.resourceDefaults).toMatchObject({ cpu: expect.any(Number), ramMB: expect.any(Number), diskGB: expect.any(Number) });
    expect(m.configApplierId).toBe('opnsense-config-import');
  });

  test('paramSchema deklariert den gemeinsamen Netzwerk-Block', () => {
    const m = getModule('opnsense');
    const keys = Object.keys(m.paramSchema);
    for (const k of ['hostname', 'ipMode', 'staticIp', 'cidr', 'gateway', 'vlanTag', 'dns']) {
      expect(keys).toContain(k);
    }
  });

  test('paramSchema-Felder tragen Typ + required-Flag', () => {
    const m = getModule('opnsense');
    expect(m.paramSchema.vlanTag).toMatchObject({ type: expect.any(String) });
    expect(m.paramSchema.staticIp).toHaveProperty('required');
  });

  test('unbekanntes Modul → Fehler mit Status 404', () => {
    expect(() => getModule('does-not-exist')).toThrow();
    try {
      getModule('does-not-exist');
    } catch (e) {
      expect(e.status || e.statusCode).toBe(404);
    }
  });

  test('ModuleDefinition ist read-only (kein direktes Feld-Mutieren nach außen)', () => {
    const m = getModule('opnsense');
    const before = JSON.stringify(m.resourceDefaults);
    m.resourceDefaults.cpu = 999;                  // Mutation an der Kopie darf das Original nicht ändern
    expect(JSON.stringify(getModule('opnsense').resourceDefaults)).toBe(before);
  });

  test('opnsense trägt kind=vm-clone', () => {
    expect(getModule('opnsense').kind).toBe('vm-clone');
    expect(getModule('opnsense').paramSchema.ipMode.values).toEqual(['static']);
  });
});

describe('deployModuleCatalog — agent-install-Modul: linux-client', () => {
  test('listModules enthält linux-client', () => {
    expect(listModules().map((m) => m.id)).toContain('linux-client');
  });

  test('linux-client ist kind=agent-install mit ssh-systemd-Adapter + existing-host-Ziel', () => {
    const m = getModule('linux-client');
    expect(m.kind).toBe('agent-install');
    expect(m.controlAdapter).toBe('ssh-systemd');
    expect(m.targetKind).toBe('existing-host');
    // KEINE VM-Klon-Felder.
    expect(m.templateRefField).toBeUndefined();
    expect(m.resourceDefaults).toBeUndefined();
    expect(m.configApplierId).toBeUndefined();
  });

  test('paramSchema deklariert targetHost + wazuhManager (required) + sshUser/sshPort', () => {
    const p = getModule('linux-client').paramSchema;
    expect(p.targetHost).toMatchObject({ required: true });
    expect(p.wazuhManager).toMatchObject({ required: true });
    expect(Object.keys(p)).toEqual(expect.arrayContaining(['targetHost', 'sshUser', 'sshPort', 'wazuhManager']));
  });

  test('toJSON(agent-install) zeigt controlAdapter, keine resourceDefaults', () => {
    const j = getModule('linux-client').toJSON();
    expect(j.kind).toBe('agent-install');
    expect(j.controlAdapter).toBe('ssh-systemd');
    expect(j).not.toHaveProperty('resourceDefaults');
  });
});

describe('deployModuleCatalog — vm-clone-Modul: windows-server (Slice 1, inert)', () => {
  test('listModules enthält windows-server', () => {
    expect(listModules().map((m) => m.id)).toContain('windows-server');
  });

  test('windows-server ist kind=vm-clone mit Template-Referenz, Ressourcen + configApplierId', () => {
    const m = getModule('windows-server');
    expect(m.kind).toBe('vm-clone');
    expect(m.type).toBe('server');
    expect(m.templateRefField).toBe('templateVmid');
    expect(m.resourceDefaults).toMatchObject({ cpu: expect.any(Number), ramMB: expect.any(Number), diskGB: expect.any(Number) });
    expect(m.configApplierId).toBe('windows-server-config'); // Applier folgt Slice 2 (bis dahin inert)
    // KEINE agent-install-Felder.
    expect(m.controlAdapter).toBeUndefined();
    expect(m.targetKind).toBeUndefined();
  });

  test('paramSchema deklariert Netzwerk-Block + templateVmid + adminUser (Passwort NIE im Schema)', () => {
    const p = getModule('windows-server').paramSchema;
    for (const k of ['hostname', 'ipMode', 'staticIp', 'cidr', 'gateway', 'dns', 'templateVmid', 'adminUser']) {
      expect(Object.keys(p)).toContain(k);
    }
    expect(Object.keys(p).join(',')).not.toMatch(/password|passwort|secret/i);
  });
});
