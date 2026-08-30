import { describe, test, expect } from 'vitest';
import {
  runStatusTone, runStatusLabel, isInProgress, isTerminal,
  canApply, applyDisabledReason, summarizeParams, redactParams, preconditionsSummary,
  stepLabel, stepStatusTone, buildAgentInstallSpecBody, buildWindowsServerSpecBody,
} from './deployView';

describe('runStatus Tone/Label', () => {
  test('deployed → success, failed_safe_stop → danger, planned → muted', () => {
    expect(runStatusTone('deployed')).toBe('success');
    expect(runStatusTone('failed_safe_stop')).toBe('danger');
    expect(runStatusTone('planned')).toBe('muted');
    expect(runStatusTone('cloning')).toBe('warning');
  });
  test('Labels sind deutsch + vorhanden', () => {
    expect(runStatusLabel('deployed')).toMatch(/Deployt/);
    expect(runStatusLabel('rolled_back')).toMatch(/rollt|rückgeroll|Zurückgeroll/i);
  });
  test('isInProgress / isTerminal', () => {
    expect(isInProgress('cloning')).toBe(true);
    expect(isInProgress('deployed')).toBe(false);
    expect(isTerminal('deployed')).toBe(true);
    expect(isTerminal('failed_safe_stop')).toBe(true);
    expect(isTerminal('approved')).toBe(false);
  });
});

describe('canApply / applyDisabledReason (Gate-Spiegel)', () => {
  const admin = { role: 'admin', runStatus: 'approved' as const, deployEnabled: true };

  test('admin + approved + Gate an → erlaubt', () => {
    expect(canApply(admin)).toBe(true);
    expect(applyDisabledReason(admin)).toBeNull();
  });
  test('Gate aus → nicht erlaubt, ehrlicher Grund', () => {
    const ctx = { ...admin, deployEnabled: false };
    expect(canApply(ctx)).toBe(false);
    expect(applyDisabledReason(ctx)).toMatch(/DEPLOY_ENABLED|gesperrt/i);
  });
  test('nicht approved → Hinweis auf Vier-Augen', () => {
    const ctx = { ...admin, runStatus: 'planned' as const };
    expect(canApply(ctx)).toBe(false);
    expect(applyDisabledReason(ctx)).toMatch(/genehmigt|Vier-Augen/i);
  });
  test('nicht-admin → nur Admins', () => {
    const ctx = { ...admin, role: 'analyst' };
    expect(canApply(ctx)).toBe(false);
    expect(applyDisabledReason(ctx)).toMatch(/Admin/i);
  });
});

describe('summarizeParams / redactParams — kein Secret', () => {
  test('fasst Netzwerk-Vorgaben zusammen', () => {
    const s = summarizeParams({ hostname: 'fw', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, vlanTag: 10, dns: ['10.0.10.10'] });
    expect(s).toMatch(/fw/);
    expect(s).toMatch(/10\.0\.10\.1\/24/);
    expect(s).toMatch(/VLAN 10/);
  });
  test('DHCP statt statischer IP', () => {
    expect(summarizeParams({ hostname: 'fw', ipMode: 'dhcp' })).toMatch(/DHCP/);
  });
  test('redactParams entfernt Secret-Schlüssel', () => {
    const out = redactParams({ hostname: 'fw', adminPassword: 'geheim', apiKey: 'x' });
    expect(out).toHaveProperty('hostname');
    expect(out).not.toHaveProperty('adminPassword');
    expect(out).not.toHaveProperty('apiKey');
  });
  test('summarizeParams leaked kein adminPassword', () => {
    expect(summarizeParams({ hostname: 'fw', adminPassword: 'geheim' })).not.toMatch(/geheim/);
  });
});

describe('preconditionsSummary', () => {
  test('ok → positiver Text', () => {
    expect(preconditionsSummary({ ok: true, templateExists: true, bridgeExists: true, vmidFree: true, issues: [] })).toMatch(/erfüllt/i);
  });
  test('nicht ok → listet Issues', () => {
    expect(preconditionsSummary({ ok: false, templateExists: false, bridgeExists: true, vmidFree: true, issues: ['Template fehlt'] })).toMatch(/Template fehlt/);
  });
  test('agent-install → geplante Aktion statt Template/Bridge/VMID', () => {
    const s = preconditionsSummary({ ok: true, kind: 'agent-install', controlAdapter: 'ssh-systemd', targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', agentName: 'web01', issues: [] });
    expect(s).toMatch(/Wazuh-Agent/i);
    expect(s).toMatch(/10\.0\.10\.90/);
    expect(s).toMatch(/10\.0\.10\.77/);
    expect(s).not.toMatch(/Template|VMID/i);
  });
});

describe('buildAgentInstallSpecBody', () => {
  test('baut params ohne Placement; optionale Felder nur wenn gesetzt', () => {
    const b = buildAgentInstallSpecBody('linux-client', 'c1', { targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' });
    expect(b).toMatchObject({ moduleId: 'linux-client', connectorId: 'c1' });
    expect(b.params).toEqual({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77' });
    expect(b).not.toHaveProperty('targetNode');
    expect(b).not.toHaveProperty('storage');
  });
  test('sshUser/sshPort/agentName werden durchgereicht, wenn gesetzt (Windows-Fall)', () => {
    const b = buildAgentInstallSpecBody('windows-client', 'c2', { targetHost: 'h', wazuhManager: 'm', sshUser: 'Administrator', sshPort: 2222, agentName: 'win01' });
    expect(b.params).toMatchObject({ sshUser: 'Administrator', sshPort: 2222, agentName: 'win01' });
  });
  test('sshPort=0 wird nicht durchgereicht (nur typeof number>… — 0 ist kein gültiger Port, aber Guard prüft nur Typ)', () => {
    // Defensiv: leere/undefined Felder erzeugen keine params-Keys (Modul-Defaults greifen).
    const b = buildAgentInstallSpecBody('linux-client', 'c3', { targetHost: 'h', wazuhManager: 'm', agentName: '' });
    expect(b.params).not.toHaveProperty('agentName');
    expect(b.params).not.toHaveProperty('sshUser');
    expect(b.params).not.toHaveProperty('sshPort');
  });
  test('os (Linux-Distro) wird durchgereicht, wenn gesetzt; sonst weggelassen (Modul-Default greift)', () => {
    expect(buildAgentInstallSpecBody('linux-client', 'c4', { targetHost: 'h', wazuhManager: 'm', os: 'rocky' }).params)
      .toMatchObject({ os: 'rocky' });
    expect(buildAgentInstallSpecBody('linux-client', 'c5', { targetHost: 'h', wazuhManager: 'm' }).params)
      .not.toHaveProperty('os');
  });
});

describe('buildWindowsServerSpecBody', () => {
  const conn = { id: 'pve1', targetNode: 'node-a', storage: 'zfs', bridge: 'vmbr9' };
  const res = { cpu: 4, ramMB: 8192, diskGB: 60 };

  test('static: Placement aus Connector + Netzwerk/Template/Wazuh in params', () => {
    const b = buildWindowsServerSpecBody('windows-server', conn, res, {
      hostname: 'win01', ipMode: 'static', staticIp: '10.0.10.50', cidr: 24, gateway: '10.0.10.254',
      dns: ['10.0.10.10'], templateVmid: 9100, wazuhManager: '10.0.10.77',
    });
    expect(b).toMatchObject({ moduleId: 'windows-server', connectorId: 'pve1', targetNode: 'node-a', storage: 'zfs', bridge: 'vmbr9', resources: res });
    expect(b.params).toMatchObject({ hostname: 'win01', ipMode: 'static', staticIp: '10.0.10.50', cidr: 24, gateway: '10.0.10.254', dns: ['10.0.10.10'], templateVmid: 9100, wazuhManager: '10.0.10.77' });
  });

  test('dhcp: keine Statik-Felder; optionale (wazuhManager/templateVmid) nur wenn gesetzt', () => {
    const b = buildWindowsServerSpecBody('windows-server', conn, res, { hostname: 'win02', ipMode: 'dhcp' });
    expect(b.params).toMatchObject({ hostname: 'win02', ipMode: 'dhcp' });
    expect(b.params).not.toHaveProperty('staticIp');
    expect(b.params).not.toHaveProperty('wazuhManager');
    expect(b.params).not.toHaveProperty('templateVmid');
  });

  test('storage/bridge-Defaults, wenn Connector sie nicht trägt', () => {
    const b = buildWindowsServerSpecBody('windows-server', { id: 'p', targetNode: null }, res, { hostname: 'h', ipMode: 'dhcp' });
    expect(b).toMatchObject({ storage: 'local-lvm', bridge: 'vmbr1' });
    expect(b.targetNode).toBeUndefined();
  });
});

describe('stepLabel / stepStatusTone — Run-Timeline', () => {
  test('bekannte Schritte bekommen deutsche Labels, unbekannte den Rohschlüssel', () => {
    expect(stepLabel('agent_install')).toMatch(/Agent/);
    expect(stepLabel('clone')).toMatch(/klon/i);
    expect(stepLabel('rollback_destroy')).toMatch(/Rollback/);
    expect(stepLabel('mystery_step')).toBe('mystery_step');
  });
  test('Status-Töne: ok→success, failed→danger, started→warning, sonst muted', () => {
    expect(stepStatusTone('ok')).toBe('success');
    expect(stepStatusTone('failed')).toBe('danger');
    expect(stepStatusTone('started')).toBe('warning');
    expect(stepStatusTone('weird')).toBe('muted');
  });
});

describe('summarizeParams — agent-install (Linux-Client)', () => {
  test('fasst Ziel/Manager/Agent zusammen', () => {
    const s = summarizeParams({ targetHost: '10.0.10.90', wazuhManager: '10.0.10.77', agentName: 'web01' });
    expect(s).toMatch(/Ziel 10\.0\.10\.90/);
    expect(s).toMatch(/Manager 10\.0\.10\.77/);
    expect(s).toMatch(/Agent web01/);
  });
});
