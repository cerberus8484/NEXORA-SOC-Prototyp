'use strict';

// P_GITOPS_3 — Tests für den Plan-Generator (read-only, kein Apply).
const { planNodeProfile, renderPlanMarkdown, SAFETY_LINE, BOOTSTRAP_WILL_NOT } = require('../../src/provisioning/planNodeProfile');

const normalAgent = () => ({
  node: { name: 'windows-client-01', role: 'normal_agent' },
  install: { mode: 'bootstrap_only', changeNetwork: false },
  network: { discovery: 'read_only', expectedMode: 'dhcp', applyDuringInstall: false },
  features: { inventory: true, logCollection: true },
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
  },
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
  nexora: { serverUrl: 'https://nexora.example', enrollmentProfile: 'lab-gateway' },
});

describe('P_GITOPS_3 planNodeProfile — Risiko + Wunschzustand', () => {
  test('normal_agent (DHCP): risk low, kein Wunsch-Apply, keine Approvals', () => {
    const p = planNodeProfile(normalAgent());
    expect(p).toMatchObject({ name: 'windows-client-01', role: 'normal_agent', risk: 'low' });
    expect(p.desiredFuture).toEqual([]);
    expect(p.approvals).toEqual([]);
  });

  test('network_sensor: risk medium, desiredFuture mit static IP + sniffing, sensor-approval', () => {
    const p = planNodeProfile(networkSensor());
    expect(p.risk).toBe('medium');
    expect(p.desiredFuture.join(' ')).toMatch(/10\.99\.99\.50/);
    expect(p.desiredFuture.join(' ')).toMatch(/sniffing/i);
    expect(p.approvals.join(' ')).toMatch(/sniffing|sensor/i);
  });

  test('gateway_sensor: risk high, nat/routing im Wunsch, gateway-approval', () => {
    const p = planNodeProfile(gatewaySensor());
    expect(p.risk).toBe('high');
    expect(p.desiredFuture.join(' ')).toMatch(/nat|routing/i);
    expect(p.approvals.join(' ')).toMatch(/gateway|approval/i);
  });
});

describe('P_GITOPS_3 renderPlanMarkdown — Sicherheits-Aussage immer sichtbar', () => {
  test('enthält die explizite Bootstrap-only-Zeile', () => {
    const md = renderPlanMarkdown(networkSensor());
    expect(md).toContain(SAFETY_LINE);
    expect(SAFETY_LINE).toMatch(/Bootstrap installs\/enrolls only/);
    expect(SAFETY_LINE).toMatch(/No IP\/DHCP\/Gateway\/DNS\/NAT\/Routing\/Sniffing\/Firewall changes/);
  });

  test('zeigt "Bootstrap will NOT" mit den verbotenen Änderungen', () => {
    const md = renderPlanMarkdown(gatewaySensor());
    expect(md).toMatch(/Bootstrap will NOT/i);
    for (const item of ['change IP address', 'enable NAT', 'enable sniffing', 'change Wazuh or OPNsense']) {
      expect(BOOTSTRAP_WILL_NOT.join(' ')).toContain(item.split(' ')[1] ? item : item);
    }
    expect(md).toMatch(/change IP address/);
    expect(md).toMatch(/enable NAT/);
  });

  test('zeigt Node/Role/Risk im Kopf', () => {
    const md = renderPlanMarkdown(gatewaySensor());
    expect(md).toMatch(/nexora-gateway-01/);
    expect(md).toMatch(/gateway_sensor/);
    expect(md).toMatch(/risk:\s*\*\*high\*\*/i);
  });
});
