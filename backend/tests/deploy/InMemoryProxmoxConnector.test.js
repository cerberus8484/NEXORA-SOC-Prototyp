'use strict';

// Deployment Center — Phase 3: InMemory-Proxmox-Connector (Fake für CI).
// Deterministisch, mit Fehler-Injektion je Schritt → Rollback-/Safe-Stop-Pfade
// (Phase 4) sind ohne echtes Proxmox voll testbar.

const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');
const { assertConnectorShape } = require('../../src/deploy/connectors/hypervisorConnector');

function newFake(overrides = {}) {
  return new InMemoryProxmoxConnector({
    templates: ['9000'],
    bridges: ['vmbr1'],
    usedVmids: [100],
    nextVmid: 1234,
    ...overrides,
  });
}

describe('InMemoryProxmoxConnector — Vertrag', () => {
  test('erfüllt den Connector-Vertrag (assertConnectorShape)', () => {
    expect(() => assertConnectorShape(newFake())).not.toThrow();
  });
});

describe('InMemoryProxmoxConnector — Happy-Path', () => {
  test('cloneFromTemplate liefert neue VMID und legt eine gestoppte VM an', async () => {
    const c = newFake();
    const { vmid } = await c.cloneFromTemplate('9000', { name: 'fw-lab' });
    expect(vmid).toBe(1234);
    expect(c.getVm(vmid)).toMatchObject({ status: 'stopped' });
  });

  test('setResources + attachNetwork verändern den VM-Zustand', async () => {
    const c = newFake();
    const { vmid } = await c.cloneFromTemplate('9000', {});
    await c.setResources(vmid, { cpu: 2, ramMB: 2048, diskGB: 20 });
    await c.attachNetwork(vmid, { bridge: 'vmbr1', vlanTag: 10 });
    expect(c.getVm(vmid).resources).toMatchObject({ cpu: 2, ramMB: 2048 });
    expect(c.getVm(vmid).net).toMatchObject({ bridge: 'vmbr1', vlanTag: 10 });
  });

  test('start setzt running, status meldet running/agentReady', async () => {
    const c = newFake();
    const { vmid } = await c.cloneFromTemplate('9000', {});
    expect((await c.status(vmid)).running).toBe(false);
    await c.start(vmid);
    const s = await c.status(vmid);
    expect(s.running).toBe(true);
    expect(s.agentReady).toBe(true);
  });

  test('destroy entfernt die VM (Rollback)', async () => {
    const c = newFake();
    const { vmid } = await c.cloneFromTemplate('9000', {});
    await c.destroy(vmid);
    expect(c.getVm(vmid)).toBeUndefined();
    expect((await c.status(vmid)).running).toBe(false);
  });

  test('attachConfigMedia hängt das Config-Artefakt an und liefert eine mediaRef', async () => {
    const c = newFake();
    const { vmid } = await c.cloneFromTemplate('9000', {});
    const media = { filename: 'opnsense-config-aaa.xml', guestPath: '/conf/config.xml', content: '<opnsense/>', configHash: 'a'.repeat(64), label: 'X' };
    const res = await c.attachConfigMedia(vmid, media);
    expect(res.mediaRef).toBeTruthy();
    expect(c.getVm(vmid).configMedia).toMatchObject({ content: '<opnsense/>', configHash: 'a'.repeat(64) });
  });
});

describe('InMemoryProxmoxConnector — checkPreconditions', () => {
  test('ok, wenn Template + Bridge existieren und VMID frei', async () => {
    const r = await newFake().checkPreconditions({ templateRef: '9000', bridge: 'vmbr1', vmid: 200 });
    expect(r).toMatchObject({ ok: true, templateExists: true, bridgeExists: true, vmidFree: true });
  });

  test('meldet fehlendes Template', async () => {
    const r = await newFake().checkPreconditions({ templateRef: 'nope', bridge: 'vmbr1' });
    expect(r.ok).toBe(false);
    expect(r.templateExists).toBe(false);
    expect(r.issues.join(' ')).toMatch(/template/i);
  });

  test('meldet fehlende Bridge', async () => {
    const r = await newFake().checkPreconditions({ templateRef: '9000', bridge: 'vmbrX' });
    expect(r.ok).toBe(false);
    expect(r.bridgeExists).toBe(false);
  });

  test('meldet belegte VMID', async () => {
    const r = await newFake().checkPreconditions({ templateRef: '9000', bridge: 'vmbr1', vmid: 100 });
    expect(r.ok).toBe(false);
    expect(r.vmidFree).toBe(false);
  });
});

describe('InMemoryProxmoxConnector — Fehler-Injektion (für Rollback-Tests)', () => {
  test('failOn.clone → cloneFromTemplate wirft', async () => {
    const c = newFake({ failOn: { clone: true } });
    await expect(c.cloneFromTemplate('9000', {})).rejects.toThrow(/clone/i);
  });

  test('failOn.start → start wirft, VM bleibt gestoppt', async () => {
    const c = newFake({ failOn: { start: true } });
    const { vmid } = await c.cloneFromTemplate('9000', {});
    await expect(c.start(vmid)).rejects.toThrow(/start/i);
    expect((await c.status(vmid)).running).toBe(false);
  });

  test('failOn.destroy → destroy wirft (für failed_safe_stop-Pfad)', async () => {
    const c = newFake({ failOn: { destroy: true } });
    const { vmid } = await c.cloneFromTemplate('9000', {});
    await expect(c.destroy(vmid)).rejects.toThrow(/destroy/i);
  });

  test('failOn.attachConfigMedia → attachConfigMedia wirft (für Rollback-Pfad)', async () => {
    const c = newFake({ failOn: { attachConfigMedia: true } });
    const { vmid } = await c.cloneFromTemplate('9000', {});
    await expect(c.attachConfigMedia(vmid, { filename: 'x.xml', content: '<x/>', configHash: 'a'.repeat(64) }))
      .rejects.toThrow(/attachConfigMedia/i);
  });
});
