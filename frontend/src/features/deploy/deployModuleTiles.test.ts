import { describe, test, expect } from 'vitest';
import {
  deriveModuleTiles,
  countAvailableTiles,
  TILE_CATALOG,
  type GroupedModuleTiles,
} from './deployModuleTiles';
import type { DeployModule } from './deployApi';

// Minimaler realer OPNsense-Modul-Stub (Form spiegelt das Backend).
const opnsenseModule: DeployModule = {
  id: 'opnsense',
  name: 'OPNsense Firewall',
  type: 'firewall',
  vendor: 'Deciso / OPNsense',
  version: '24.x',
  templateRefField: 'templateVmid',
  configApplierId: 'opnsense-config-import',
  resourceDefaults: { cpu: 2, ramMB: 2048, diskGB: 20 },
  paramSchema: {},
};

function firewalls(groups: GroupedModuleTiles[]) {
  const g = groups.find((x) => x.id === 'firewalls');
  if (!g) throw new Error('Firewalls-Gruppe fehlt');
  return g;
}

describe('deriveModuleTiles — Verfügbarkeit aus echten Backend-Modulen', () => {
  test('OPNsense ist verfügbar (Backend-Modul vorhanden), moduleId gesetzt', () => {
    const groups = deriveModuleTiles([opnsenseModule]);
    const opnsense = firewalls(groups).tiles.find((t) => t.productKey === 'opnsense');

    expect(opnsense).toBeDefined();
    expect(opnsense?.available).toBe(true);
    expect(opnsense?.moduleId).toBe('opnsense');
    // Realer Modulname wird bevorzugt.
    expect(opnsense?.label).toBe('OPNsense Firewall');
  });

  test('geplante Produkte (pfSense/Sophos/Fortinet/IPFire) sind NICHT verfügbar, moduleId null', () => {
    const groups = deriveModuleTiles([opnsenseModule]);
    const planned = firewalls(groups).tiles.filter((t) => t.productKey !== 'opnsense');

    expect(planned.length).toBeGreaterThan(0);
    for (const tile of planned) {
      expect(tile.available).toBe(false);
      expect(tile.moduleId).toBeNull();
    }
  });

  test('ohne Backend-Module ist NICHTS verfügbar (kein Fake-Verfügbar)', () => {
    const groups = deriveModuleTiles([]);
    for (const group of groups) {
      for (const tile of group.tiles) {
        expect(tile.available).toBe(false);
        expect(tile.moduleId).toBeNull();
      }
    }
  });

  test('unbekanntes Backend-Modul erzeugt keine zusätzliche Kachel (Katalog steuert die Anzeige)', () => {
    const unknownModule: DeployModule = { ...opnsenseModule, id: 'mystery-box', name: 'Mystery' };
    const groups = deriveModuleTiles([unknownModule]);
    const keys = groups.flatMap((g) => g.tiles.map((t) => t.productKey));

    expect(keys).not.toContain('mystery-box');
    // OPNsense fehlt hier → auch OPNsense ist nicht verfügbar.
    const opnsense = firewalls(groups).tiles.find((t) => t.productKey === 'opnsense');
    expect(opnsense?.available).toBe(false);
  });
});

describe('deriveModuleTiles — Gruppierung', () => {
  test('gruppiert unter „Firewalls" und behält die Katalog-Reihenfolge/-Anzahl', () => {
    const groups = deriveModuleTiles([opnsenseModule]);

    expect(groups.map((g) => g.id)).toEqual(TILE_CATALOG.map((c) => c.id));
    expect(firewalls(groups).label).toBe('Firewalls');
    expect(firewalls(groups).tiles.map((t) => t.productKey)).toEqual([
      'opnsense', 'pfsense', 'sophos', 'fortinet', 'ipfire',
    ]);
  });

  test('OPNsense-Kachel liegt in der Firewalls-Gruppe', () => {
    const groups = deriveModuleTiles([opnsenseModule]);
    const inFirewalls = firewalls(groups).tiles.some((t) => t.productKey === 'opnsense');
    expect(inFirewalls).toBe(true);
  });
});

describe('countAvailableTiles', () => {
  test('zählt genau die verfügbaren Kacheln (OPNsense → 1)', () => {
    const groups = deriveModuleTiles([opnsenseModule]);
    expect(countAvailableTiles(groups)).toBe(1);
  });

  test('zählt 0 ohne Module', () => {
    expect(countAvailableTiles(deriveModuleTiles([]))).toBe(0);
  });
});

describe('Endpoints-Gruppe (agent-install / Linux-Client)', () => {
  const linuxClient: DeployModule = {
    id: 'linux-client', name: 'Linux-Client (Wazuh-Agent)', type: 'endpoint', vendor: 'Wazuh',
    version: '4.x', kind: 'agent-install', controlAdapter: 'ssh-systemd', targetKind: 'existing-host', paramSchema: {},
  };
  function endpoints(groups: GroupedModuleTiles[]) {
    const g = groups.find((x) => x.id === 'endpoints');
    if (!g) throw new Error('Endpoints-Gruppe fehlt');
    return g;
  }

  test('Linux-Client ist verfügbar, wenn das Backend-Modul existiert; Windows-Client bleibt geplant', () => {
    const groups = deriveModuleTiles([linuxClient]);
    const lin = endpoints(groups).tiles.find((t) => t.productKey === 'linux-client');
    const win = endpoints(groups).tiles.find((t) => t.productKey === 'windows-client');
    expect(lin?.available).toBe(true);
    expect(lin?.moduleId).toBe('linux-client');
    expect(win?.available).toBe(false);
    expect(win?.moduleId).toBeNull();
  });

  test('ohne Backend-Modul ist der Linux-Client NICHT verfügbar (kein Fake)', () => {
    const lin = deriveModuleTiles([]).find((g) => g.id === 'endpoints')?.tiles.find((t) => t.productKey === 'linux-client');
    expect(lin?.available).toBe(false);
  });

  test('windows-server erscheint in der Server-Gruppe und ist verfügbar, wenn das Backend-Modul existiert', () => {
    const winModule: DeployModule = {
      id: 'windows-server', name: 'Windows Server (VM)', type: 'server', vendor: 'Microsoft', version: '2022',
      templateRefField: 'templateVmid', configApplierId: 'windows-server-config',
      resourceDefaults: { cpu: 4, ramMB: 8192, diskGB: 60 }, paramSchema: {},
    };
    const servers = deriveModuleTiles([winModule]).find((g) => g.id === 'servers');
    const win = servers?.tiles.find((t) => t.productKey === 'windows-server');
    expect(win?.available).toBe(true);
    expect(win?.moduleId).toBe('windows-server');
    // Ohne Backend-Modul: nicht verfügbar (kein Fake).
    expect(deriveModuleTiles([]).find((g) => g.id === 'servers')?.tiles[0].available).toBe(false);
  });
});

// ── Phase 3: Kollektoren / Data-Plane ────────────────────────────────────────
// Der Firewall-Collector ist das erste Kollektor-Modul (agent-install, Release-
// Artefakt + SHA256-Pruefung). Er muss im Katalog eine eigene Gruppe bekommen —
// sonst waere er zwar deploybar, aber im Deployment Center unsichtbar.
describe('Kollektoren-Gruppe', () => {
  const collector = {
    id: 'firewall-collector', name: 'Firewall-Collector (Nexora Data-Plane)',
    type: 'collector', vendor: 'Nexora', version: 'release',
    kind: 'agent-install' as const, paramSchema: {},
  };

  it('zeigt den Firewall-Collector als verfuegbar, wenn das Backend ihn liefert', () => {
    const groups = deriveModuleTiles([collector]);
    const grp = groups.find((g) => g.id === 'collectors');

    expect(grp).toBeTruthy();
    const tile = grp!.tiles.find((t) => t.productKey === 'firewall-collector');
    expect(tile?.available).toBe(true);
    expect(tile?.moduleId).toBe('firewall-collector');
    expect(tile?.label).toBe('Firewall-Collector (Nexora Data-Plane)'); // echter Backend-Name
  });

  it('geplante Kollektoren bleiben ehrlich als NICHT verfuegbar stehen', () => {
    const grp = deriveModuleTiles([collector]).find((g) => g.id === 'collectors');
    const planned = grp!.tiles.filter((t) => t.productKey !== 'firewall-collector');

    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((t) => t.available === false)).toBe(true);
    expect(planned.every((t) => t.moduleId === null)).toBe(true);
  });

  it('ohne Backend-Modul ist auch der Collector nicht verfuegbar (nichts vorgetaeuscht)', () => {
    const grp = deriveModuleTiles([]).find((g) => g.id === 'collectors');
    expect(grp!.tiles.every((t) => t.available === false)).toBe(true);
  });
});
