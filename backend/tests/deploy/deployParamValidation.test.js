'use strict';

// Deployment Center — Phase 2: paramSchema-Validierung (fail-fast am System-Rand).
// Netzwerk-Block + vendor-spezifisch, kompiliert aus module.paramSchema.
// Secrets (adminPassword) werden hart abgelehnt; unbekannte Keys gestrippt.

const { validateAgainstModule, validateNetworkBlock } = require('../../src/deploy/deployParamValidation');
const { getModule } = require('../../src/deploy/deployModuleCatalog');

const opnsense = getModule('opnsense');

function validParams(overrides = {}) {
  return {
    hostname: 'fw-lab',
    ipMode: 'static',
    staticIp: '10.0.10.1',
    cidr: 24,
    gateway: '10.0.10.254',
    vlanTag: 10,
    dns: ['10.0.10.10'],
    wanInterface: 'vtnet0',
    lanInterface: 'vtnet1',
    ...overrides,
  };
}

describe('validateAgainstModule — gültige Eingaben', () => {
  test('vollständige OPNsense-Params passieren', () => {
    const { value } = validateAgainstModule(opnsense, validParams());
    expect(value.staticIp).toBe('10.0.10.1');
    expect(value.vlanTag).toBe(10);
  });

  test('unbekannte Keys werden gestrippt', () => {
    const { value } = validateAgainstModule(opnsense, validParams({ foo: 'bar', extra: 1 }));
    expect(value).not.toHaveProperty('foo');
    expect(value).not.toHaveProperty('extra');
  });
});

describe('validateAgainstModule — Secret-Ablehnung', () => {
  test('adminPassword im Klartext → deny (write-only, nie im Spec)', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ adminPassword: 'geheim!' }))).toThrow(/secret|password/i);
  });

  test('verschachteltes Secret → deny', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ lan: { apiKey: 'x' } }))).toThrow(/secret|api/i);
  });
});

describe('validateAgainstModule — ungültige Netzwerk-Werte', () => {
  test('staticIp keine IPv4 → Fehler', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ staticIp: '999.1.1.1' }))).toThrow(/staticIp/);
    expect(() => validateAgainstModule(opnsense, validParams({ staticIp: 'nope' }))).toThrow(/staticIp/);
  });

  test('cidr außerhalb 0–32 → Fehler', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ cidr: 33 }))).toThrow(/cidr/);
    expect(() => validateAgainstModule(opnsense, validParams({ cidr: -1 }))).toThrow(/cidr/);
  });

  test('vlanTag Grenzen: 0 und 4095 → Fehler, 1/10/4094 ok', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ vlanTag: 0 }))).toThrow(/vlanTag/);
    expect(() => validateAgainstModule(opnsense, validParams({ vlanTag: 4095 }))).toThrow(/vlanTag/);
    expect(() => validateAgainstModule(opnsense, validParams({ vlanTag: 'abc' }))).toThrow(/vlanTag/);
    for (const ok of [1, 10, 4094]) {
      expect(validateAgainstModule(opnsense, validParams({ vlanTag: ok })).value.vlanTag).toBe(ok);
    }
  });

  test('dns leer / >3 / keine IPv4 → Fehler', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ dns: [] }))).toThrow(/dns/);
    expect(() => validateAgainstModule(opnsense, validParams({ dns: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'] }))).toThrow(/dns/);
    expect(() => validateAgainstModule(opnsense, validParams({ dns: ['not-an-ip'] }))).toThrow(/dns/);
  });

  test('fehlende Pflichtfelder → Fehler', () => {
    const p = validParams(); delete p.staticIp;
    expect(() => validateAgainstModule(opnsense, p)).toThrow(/staticIp/);
    const q = validParams(); delete q.hostname;
    expect(() => validateAgainstModule(opnsense, q)).toThrow(/hostname/);
  });

  test('Interface-Name mit Sonderzeichen → Fehler (Regex-Guard)', () => {
    expect(() => validateAgainstModule(opnsense, validParams({ lanInterface: 'vtnet0; rm -rf /' }))).toThrow(/lanInterface/);
    expect(() => validateAgainstModule(opnsense, validParams({ wanInterface: 'a b' }))).toThrow(/wanInterface/);
    expect(validateAgainstModule(opnsense, validParams({ lanInterface: 'em0' })).value.lanInterface).toBe('em0');
  });
});

describe('validateAgainstModule — ipMode dhcp lockert bedingte Pflichtfelder', () => {
  test('dhcp ohne staticIp/cidr/gateway/dns ist gültig', () => {
    const { value } = validateAgainstModule(opnsense, {
      hostname: 'fw-dhcp', ipMode: 'dhcp', wanInterface: 'vtnet0', lanInterface: 'vtnet1',
    });
    expect(value.ipMode).toBe('dhcp');
  });
});

describe('validateNetworkBlock — nur der gemeinsame Block', () => {
  test('gültiger Block passiert', () => {
    const { value } = validateNetworkBlock({
      hostname: 'h', ipMode: 'static', staticIp: '10.0.0.5', cidr: 24, gateway: '10.0.0.1', dns: ['10.0.0.10'],
    });
    expect(value.gateway).toBe('10.0.0.1');
  });

  test('ungültige gateway-IP → Fehler', () => {
    expect(() => validateNetworkBlock({
      hostname: 'h', ipMode: 'static', staticIp: '10.0.0.5', cidr: 24, gateway: 'x', dns: ['10.0.0.10'],
    })).toThrow(/gateway/);
  });
});

// ── linux-client (agent-install) — schema-getriebene Validierung + Injektions-Schutz ──
describe('validateAgainstModule — linux-client (agent-install)', () => {
  const linux = getModule('linux-client');

  test('gültige Params: Defaults (sshUser=root, sshPort=22) werden gesetzt', () => {
    const { value } = validateAgainstModule(linux, { targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' });
    expect(value).toMatchObject({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', sshUser: 'root', sshPort: 22 });
  });

  test('Injektion im targetHost wird abgelehnt (Pattern) — RCE-Schutz', () => {
    expect(() => validateAgainstModule(linux, { targetHost: '10.0.10.90; rm -rf /', wazuhManager: '10.0.10.77' }))
      .toThrow(/targetHost/);
  });

  test('fehlender wazuhManager wird abgelehnt', () => {
    expect(() => validateAgainstModule(linux, { targetHost: '10.0.10.90' })).toThrow(/wazuhManager/);
  });

  test('ungültiger sshUser (Sonderzeichen) wird abgelehnt', () => {
    expect(() => validateAgainstModule(linux, { targetHost: 'h', wazuhManager: 'm', sshUser: 'ro ot' })).toThrow(/sshUser/);
  });

  test('os: fehlend → Default debian; gültige Distro passiert; unbekanntes os abgelehnt (Enum)', () => {
    expect(validateAgainstModule(linux, { targetHost: 'h', wazuhManager: 'm' }).value.os).toBe('debian');
    expect(validateAgainstModule(linux, { targetHost: 'h', wazuhManager: 'm', os: 'rocky' }).value.os).toBe('rocky');
    expect(() => validateAgainstModule(linux, { targetHost: 'h', wazuhManager: 'm', os: 'windows' })).toThrow(/os/);
    expect(() => validateAgainstModule(linux, { targetHost: 'h', wazuhManager: 'm', os: 'debian; rm -rf /' })).toThrow(/os/);
  });
});

// ── windows-server (vm-clone, Slice 1) — Netzwerk-Block + Windows-Params ──
describe('validateAgainstModule — windows-server (vm-clone)', () => {
  const win = getModule('windows-server');
  const winParams = (o = {}) => ({ hostname: 'win01', ipMode: 'static', staticIp: '10.0.10.50', cidr: 24, gateway: '10.0.10.254', dns: ['10.0.10.10'], ...o });

  test('gültige Params → Netzwerk ok + adminUser-Default Administrator', () => {
    expect(validateAgainstModule(win, winParams()).value).toMatchObject({ hostname: 'win01', adminUser: 'Administrator' });
  });

  test('Injektion im adminUser wird abgelehnt (Pattern) — Defense-in-Depth', () => {
    expect(() => validateAgainstModule(win, winParams({ adminUser: 'Administrator; rm -rf /' }))).toThrow(/adminUser/);
  });

  test('Secret (adminPassword im Klartext) → deny (write-only, nie im Spec)', () => {
    expect(() => validateAgainstModule(win, winParams({ adminPassword: 'geheim!' }))).toThrow(/secret|password/i);
  });

  test('ungültige staticIp → Fehler (gemeinsamer Netzwerk-Block gilt auch hier)', () => {
    expect(() => validateAgainstModule(win, winParams({ staticIp: 'nope' }))).toThrow(/staticIp/);
  });

  test('wazuhManager: optional; gültig passiert, Injektion abgelehnt', () => {
    expect(validateAgainstModule(win, winParams({ wazuhManager: '10.0.10.77' })).value.wazuhManager).toBe('10.0.10.77');
    expect(() => validateAgainstModule(win, winParams({ wazuhManager: 'm; rm -rf /' }))).toThrow(/wazuhManager/);
  });
});
