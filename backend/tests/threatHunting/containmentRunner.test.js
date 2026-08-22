'use strict';

// ADR-042 Slice 3a — Containment-Runner (Bridge action → sshExecRunner).
// Alles fail-closed: der Runner darf NIE einen Kanal öffnen, wenn eine Vorbedingung
// fehlt. Kern-Invariante: Isolation OHNE Mgmt-Preservation-CIDR wird verweigert
// (Selbst-Aussperr-Schutz — sonst wäre die spätere Freigabe nicht mehr zustellbar).

const { buildContainmentRunner } = require('../../src/threatHunting/adapters/containmentRunner');

// ── Test-Doubles ────────────────────────────────────────────────────────────
const NODE = Object.freeze({
  id: 'n1', name: 'web01', role: 'endpoint',
  ip: '10.0.10.80', os: 'ubuntu', hostKeyPin: 'a'.repeat(64), status: 'active',
});

function makeDeps(overrides = {}) {
  const calls = { createRunner: [], ssh: [] };
  const sshRunner = jest.fn(async (job) => { calls.ssh.push(job); return { code: 0, timedOut: false }; });
  const deps = {
    provisioningRepo: {
      findNodesByIp: jest.fn(async (ip) => (ip === NODE.ip ? [{ ...NODE }] : [])),
    },
    resolvePrivateKey: jest.fn(async () => 'PRIVATE_KEY_PEM'),
    createRunner: jest.fn((opts) => { calls.createRunner.push(opts); return sshRunner; }),
    getMgmt: jest.fn(() => ({ cidr: '10.0.10.0/24', port: '22' })),
    ...overrides,
  };
  return { deps, calls, sshRunner };
}

const isolate = { id: 'a1', kind: 'isolate_host', targetHost: NODE.ip, requestedBy: 'u-req' };
const release = { id: 'a2', kind: 'release_isolation', targetHost: NODE.ip, requestedBy: 'u-req' };

describe('buildContainmentRunner — happy paths', () => {
  it('isolate_host: baut Runner mit gepinntem Host-Key + Allowlist und ruft Skript isolate-host mit Mgmt-ENV', async () => {
    const { deps, calls, sshRunner } = makeDeps();
    const factory = buildContainmentRunner(deps);
    const runner = await factory(isolate);
    const res = await runner({ action: { id: isolate.id, kind: isolate.kind, targetHost: isolate.targetHost } });

    expect(res).toEqual({ code: 0, timedOut: false });
    // Host-Key-Pinning + Allowlist strikt auf die eine Node-IP.
    expect(calls.createRunner[0]).toMatchObject({
      privateKey: 'PRIVATE_KEY_PEM',
      hostKeys: { [NODE.ip]: NODE.hostKeyPin },
      allowedHosts: [NODE.ip],
    });
    const job = sshRunner.mock.calls[0][0];
    expect(job).toMatchObject({
      host: NODE.ip,
      user: 'root',
      scriptId: 'isolate-host',
      env: { NEXORA_MGMT_CIDR: '10.0.10.0/24', NEXORA_MGMT_SSH_PORT: '22' },
    });
  });

  it('release_isolation: Skript release-isolation, KEINE Mgmt-CIDR nötig (Freigabe ist immer sicher)', async () => {
    const { deps, sshRunner } = makeDeps({ getMgmt: () => ({ cidr: null, port: '22' }) });
    const factory = buildContainmentRunner(deps);
    const runner = await factory(release);
    const res = await runner({ action: { id: release.id, kind: release.kind, targetHost: release.targetHost } });

    expect(res).toEqual({ code: 0, timedOut: false });
    expect(sshRunner.mock.calls[0][0]).toMatchObject({ host: NODE.ip, scriptId: 'release-isolation' });
  });

  it('Windows-Node isolate → routet auf isolate-host-windows mit Mgmt-ENV (kein E_UNSUPPORTED_OS mehr)', async () => {
    const { deps, sshRunner } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, os: 'windows-server-2022' }]) },
    });
    const runner = await buildContainmentRunner(deps)(isolate);
    await runner({ action: { id: isolate.id, kind: isolate.kind, targetHost: isolate.targetHost } });
    expect(sshRunner.mock.calls[0][0]).toMatchObject({
      host: NODE.ip,
      user: 'Administrator',
      scriptId: 'isolate-host-windows',
      env: { NEXORA_MGMT_CIDR: '10.0.10.0/24', NEXORA_MGMT_SSH_PORT: '22' },
    });
  });

  it('Windows-Node release → routet auf release-isolation-windows', async () => {
    const { deps, sshRunner } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, os: 'windows' }]) },
    });
    const runner = await buildContainmentRunner(deps)(release);
    await runner({ action: { id: release.id, kind: release.kind, targetHost: release.targetHost } });
    expect(sshRunner.mock.calls[0][0]).toMatchObject({ host: NODE.ip, scriptId: 'release-isolation-windows' });
  });

  it('node.sshUser übersteuert den OS-Default-User (aus der Registry)', async () => {
    const { deps, sshRunner } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, os: 'windows', sshUser: 'svc-ir' }]) },
    });
    const runner = await buildContainmentRunner(deps)(release);
    await runner({ action: { id: release.id, kind: release.kind, targetHost: release.targetHost } });
    expect(sshRunner.mock.calls[0][0]).toMatchObject({ user: 'svc-ir', scriptId: 'release-isolation-windows' });
  });

  it('ungültiger node.sshUser → OS-Default (kein durchgereichter Fremd-User)', async () => {
    const { deps, sshRunner } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, os: 'ubuntu', sshUser: 'bad user;rm' }]) },
    });
    const runner = await buildContainmentRunner(deps)(release);
    await runner({ action: { id: release.id, kind: release.kind, targetHost: release.targetHost } });
    expect(sshRunner.mock.calls[0][0]).toMatchObject({ user: 'root' });
  });
});

describe('buildContainmentRunner — fail-closed', () => {
  async function expectFactoryReject(deps, action, code) {
    const factory = buildContainmentRunner(deps);
    await expect(factory(action)).rejects.toMatchObject({ code });
  }

  it('kein Node in der Registry → E_NO_NODE, kein Runner gebaut', async () => {
    const { deps, calls } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => []) },
    });
    await expectFactoryReject(deps, isolate, 'E_NO_NODE');
    expect(calls.createRunner).toHaveLength(0);
  });

  it('mehrere Nodes für dieselbe IP → E_AMBIGUOUS_NODE (fail-closed, kein Runner)', async () => {
    const { deps, calls } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE }, { ...NODE, id: 'n2', name: 'web01b' }]) },
    });
    await expectFactoryReject(deps, isolate, 'E_AMBIGUOUS_NODE');
    expect(calls.createRunner).toHaveLength(0);
  });

  // M-1 (Security-Review): nur AKTIV verwaltete Nodes sind Ziel — ein 'retired' Record mit
  // stalem host_key_pin (DHCP: IP jetzt an anderem Host) darf das Targeting nie verwässern.
  it('nur ein retired Node an der IP → E_NO_NODE (decommissioned wird ausgeschlossen)', async () => {
    const { deps, calls } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, status: 'retired' }]) },
    });
    await expectFactoryReject(deps, isolate, 'E_NO_NODE');
    expect(calls.createRunner).toHaveLength(0);
  });

  it('aktiver + retired Node teilen die IP → retired gefiltert, aktiver genutzt (nicht mehr ambiguous)', async () => {
    const { deps, calls } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [
        { ...NODE, status: 'active' }, { ...NODE, id: 'n-old', status: 'retired' },
      ]) },
    });
    const runner = await buildContainmentRunner(deps)(isolate);
    await runner({ action: { id: isolate.id, kind: isolate.kind, targetHost: isolate.targetHost } });
    expect(calls.createRunner[0]).toMatchObject({ hostKeys: { [NODE.ip]: NODE.hostKeyPin } });
  });

  it('kein Deploy-Private-Key → E_NO_CHANNEL', async () => {
    const { deps } = makeDeps({ resolvePrivateKey: jest.fn(async () => null) });
    await expectFactoryReject(deps, isolate, 'E_NO_CHANNEL');
  });

  it('Node ohne gepinnten Host-Key → E_NO_HOSTKEY (kein TOFU)', async () => {
    const { deps } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, hostKeyPin: null }]) },
    });
    await expectFactoryReject(deps, isolate, 'E_NO_HOSTKEY');
  });

  it('Node ohne IP → E_NO_HOST', async () => {
    const { deps } = makeDeps({
      provisioningRepo: { findNodesByIp: jest.fn(async () => [{ ...NODE, ip: null }]) },
    });
    await expectFactoryReject(deps, isolate, 'E_NO_HOST');
  });

  it('isolate_host OHNE Mgmt-CIDR → E_NO_MGMT_PRESERVE (Selbst-Aussperr-Schutz)', async () => {
    const { deps, calls } = makeDeps({ getMgmt: () => ({ cidr: null, port: '22' }) });
    await expectFactoryReject(deps, isolate, 'E_NO_MGMT_PRESERVE');
    expect(calls.createRunner).toHaveLength(0);
  });

  it('nicht-Containment-Kind (privileged_command) → E_UNSUPPORTED_KIND (Defense-in-Depth)', async () => {
    const { deps } = makeDeps();
    await expectFactoryReject(deps, { id: 'a3', kind: 'privileged_command', targetHost: NODE.ip }, 'E_UNSUPPORTED_KIND');
  });
});
