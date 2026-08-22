'use strict';

// P_GITOPS_2 — Tests für den reinen Node-Profil-Validator (validate-only).
// Prüft NUR Struktur/Sicherheit. Kein Apply, kein Netzwerk, kein I/O.
const { validateNodeProfile, KNOWN_ROLES } = require('../../src/provisioning/validateNodeProfile');

// ── Gültige Basis-Profile (entsprechen den Design-Beispielen A/B/C) ──────────
const normalAgent = () => ({
  node: { name: 'windows-client-01', role: 'normal_agent', labels: { environment: 'lab' } },
  install: { mode: 'bootstrap_only', changeNetwork: false },
  network: { discovery: 'read_only', expectedMode: 'dhcp', applyDuringInstall: false },
  features: {
    inventory: true, logCollection: true, commandConsole: false,
    sniffing: { requested: false, applyDuringInstall: false },
    nat: { requested: false, applyDuringInstall: false },
  },
  nexora: { serverUrl: 'https://nexora.example', enrollmentProfile: 'lab-agent' },
});

const networkSensor = () => ({
  node: { name: 'nexora-sensor-01', role: 'network_sensor' },
  install: { mode: 'bootstrap_only', changeNetwork: false },
  network: { discovery: 'read_only', applyDuringInstall: false,
    desiredState: { mode: 'static', managementInterface: 'eth0', ip: '10.99.99.50', cidr: 24, gateway: '10.99.99.1', dns: ['10.99.99.10'] } },
  features: {
    syslogReceiver: { requested: true }, flowCollector: { requested: true },
    sniffing: { requested: true, interface: 'eth1', mode: 'passive', applyDuringInstall: false, requiresApproval: true },
    nat: { requested: false, applyDuringInstall: false },
  },
  safety: { previewRequired: true, approvalRequired: true, rollbackRequiredForNetworkChanges: true },
  nexora: { serverUrl: 'https://nexora.example', enrollmentProfile: 'lab-sensor' },
});

const gatewaySensor = () => ({
  node: { name: 'nexora-gateway-01', role: 'gateway_sensor' },
  install: { mode: 'bootstrap_only', changeNetwork: false },
  network: { discovery: 'read_only', applyDuringInstall: false,
    desiredState: { mode: 'static', managementInterface: 'eth0', ip: '10.99.99.60', cidr: 24, gateway: '10.99.99.1', dns: ['10.99.99.10'] } },
  features: {
    routing: { requested: true, applyDuringInstall: false, requiresApproval: true },
    nat: { requested: true, outboundInterface: 'eth0', internalInterface: 'eth1', applyDuringInstall: false, requiresApproval: true },
  },
  safety: { changeWindowRequired: true, rollbackRequired: true, approval: { required: true, minimumReviewers: 1 } },
  nexora: { serverUrl: 'https://nexora.example', enrollmentProfile: 'lab-gateway' },
});

const errs = (p) => validateNodeProfile(p).errors.join(' | ');

describe('P_GITOPS_2 validateNodeProfile — gültige Design-Beispiele', () => {
  test('A) normal_agent (Bootstrap, DHCP read-only) ist gültig', () => {
    expect(validateNodeProfile(normalAgent())).toEqual({ ok: true, errors: [] });
  });
  test('B) network_sensor (desiredState + sniffing requested, kein apply) ist gültig', () => {
    expect(validateNodeProfile(networkSensor())).toEqual({ ok: true, errors: [] });
  });
  test('C) gateway_sensor (nat/routing requested, kein apply) ist gültig', () => {
    expect(validateNodeProfile(gatewaySensor())).toEqual({ ok: true, errors: [] });
  });
  test('KNOWN_ROLES exportiert die fünf Rollen', () => {
    expect(KNOWN_ROLES).toEqual(expect.arrayContaining(['control_plane', 'normal_agent', 'integration_connector', 'network_sensor', 'gateway_sensor']));
  });
});

describe('P_GITOPS_2 validateNodeProfile — Struktur', () => {
  test('Nicht-Objekt / leer → Fehler, kein Crash', () => {
    expect(validateNodeProfile(null).ok).toBe(false);
    expect(validateNodeProfile(undefined).ok).toBe(false);
    expect(validateNodeProfile('x').ok).toBe(false);
  });
  test('fehlender node.name → Fehler', () => {
    const p = normalAgent(); delete p.node.name;
    expect(validateNodeProfile(p).ok).toBe(false);
    expect(errs(p)).toMatch(/node\.name/);
  });
  test('unbekannte role → Fehler', () => {
    const p = normalAgent(); p.node.role = 'super_admin';
    expect(validateNodeProfile(p).ok).toBe(false);
    expect(errs(p)).toMatch(/role/);
  });
});

describe('P_GITOPS_2 validateNodeProfile — harte Sicherheits-Gates', () => {
  test('install.changeNetwork=true → Fehler', () => {
    const p = normalAgent(); p.install.changeNetwork = true;
    expect(errs(p)).toMatch(/changeNetwork/);
  });
  test('network.applyDuringInstall=true → Fehler', () => {
    const p = networkSensor(); p.network.applyDuringInstall = true;
    expect(errs(p)).toMatch(/applyDuringInstall/);
  });
  test('sniffing.applyDuringInstall=true → Fehler (Apply verboten)', () => {
    const p = networkSensor(); p.features.sniffing.applyDuringInstall = true;
    expect(errs(p)).toMatch(/sniffing.*applyDuringInstall|applyDuringInstall.*sniffing/);
  });
  test('nat.applyDuringInstall=true → Fehler (Apply verboten)', () => {
    const p = gatewaySensor(); p.features.nat.applyDuringInstall = true;
    expect(errs(p)).toMatch(/nat.*applyDuringInstall|applyDuringInstall.*nat/);
  });
  test('routing.applyDuringInstall=true → Fehler', () => {
    const p = gatewaySensor(); p.features.routing.applyDuringInstall = true;
    expect(errs(p)).toMatch(/routing.*applyDuringInstall|applyDuringInstall.*routing/);
  });
});

describe('P_GITOPS_2 validateNodeProfile — Rollen-Restriktionen', () => {
  test('normal_agent mit sniffing.requested=true → Fehler', () => {
    const p = normalAgent(); p.features.sniffing.requested = true;
    expect(errs(p)).toMatch(/normal_agent.*sniffing|sniffing.*normal_agent/);
  });
  test('normal_agent mit nat.requested=true → Fehler', () => {
    const p = normalAgent(); p.features.nat.requested = true;
    expect(errs(p)).toMatch(/nat/);
  });
  test('sniffing.requested nur für network_sensor — gateway_sensor → Fehler', () => {
    const p = gatewaySensor(); p.features.sniffing = { requested: true, interface: 'eth2', applyDuringInstall: false };
    expect(errs(p)).toMatch(/sniffing.*network_sensor|network_sensor.*sniffing/);
  });
  test('nat.requested nur für gateway_sensor — network_sensor → Fehler', () => {
    const p = networkSensor(); p.features.nat = { requested: true, applyDuringInstall: false };
    expect(errs(p)).toMatch(/nat.*gateway_sensor|gateway_sensor.*nat/);
  });
  test('routing.requested nur für gateway_sensor — network_sensor → Fehler', () => {
    const p = networkSensor(); p.features.routing = { requested: true, applyDuringInstall: false };
    expect(errs(p)).toMatch(/routing.*gateway_sensor|gateway_sensor.*routing/);
  });
});

describe('P_GITOPS_2 validateNodeProfile — keine Secrets im YAML', () => {
  test('Schlüssel wie enrollmentToken/password/apiKey → Fehler', () => {
    const p1 = normalAgent(); p1.nexora.enrollmentToken = 'eyJhbGciOi...';
    expect(errs(p1)).toMatch(/secret|token/i);
    const p2 = normalAgent(); p2.nexora.password = 'hunter2';
    expect(errs(p2)).toMatch(/secret|password/i);
    const p3 = normalAgent(); p3.features.apiKey = 'sk-123';
    expect(validateNodeProfile(p3).ok).toBe(false);
  });
  test('enrollmentProfile (Referenz, kein Secret) ist erlaubt', () => {
    expect(validateNodeProfile(normalAgent()).ok).toBe(true);
  });
});
