'use strict';

// Deployment Center — Phase 4: InMemory-Deploy-Repository.
// Single-flight + Replay als Backstop; Steps/Audit append-only.

const { InMemoryDeployRepository } = require('../../src/deploy/InMemoryDeployRepository');

function repo() { return new InMemoryDeployRepository(); }

describe('InMemoryDeployRepository — Specs + Connectors', () => {
  test('createConnector/getConnector round-trip', async () => {
    const r = repo();
    await r.createConnector({ id: 'c1', type: 'proxmox', name: 'L' });
    expect(await r.getConnector('c1')).toMatchObject({ id: 'c1', type: 'proxmox' });
  });

  test('findSpecByHash findet die Spec (Idempotenz-Basis)', async () => {
    const r = repo();
    await r.createSpec({ id: 's1', specHash: 'abc', moduleId: 'opnsense' });
    expect(await r.findSpecByHash('abc')).toMatchObject({ id: 's1' });
    expect(await r.findSpecByHash('nope')).toBeNull();
  });
});

describe('InMemoryDeployRepository — Runs, Single-flight, Replay', () => {
  test('findActiveRun liefert einen aktiven Run', async () => {
    const r = repo();
    await r.createRun({ id: 'run1', specId: 's1', status: 'planned' });
    expect(await r.findActiveRun()).toBeNull();
    await r.updateRun({ id: 'run1', specId: 's1', status: 'applying' });
    expect(await r.findActiveRun()).toMatchObject({ id: 'run1' });
  });

  test('listRuns liefert die jüngsten Runs zuerst und begrenzt die Übersicht', async () => {
    const r = repo();
    await r.createRun({ id: 'old', specId: 's1', status: 'planned', startedAt: '2026-08-01T12:00:00.000Z' });
    await r.createRun({ id: 'new', specId: 's2', status: 'planned', startedAt: '2026-08-02T12:00:00.000Z' });

    await expect(r.listRuns(1)).resolves.toEqual([expect.objectContaining({ id: 'new' })]);
  });

  test('Single-flight: zweiter aktiver Run wirft ACTIVE_RUN_CONFLICT', async () => {
    const r = repo();
    await r.createRun({ id: 'a', specId: 's1', status: 'planned' });
    await r.createRun({ id: 'b', specId: 's2', status: 'planned' });
    await r.updateRun({ id: 'a', specId: 's1', status: 'applying' });
    await expect(r.updateRun({ id: 'b', specId: 's2', status: 'cloning' }))
      .rejects.toMatchObject({ code: 'ACTIVE_RUN_CONFLICT' });
  });

  test('Replay: zweiter deployed Run je Spec wirft DEPLOYED_CONFLICT', async () => {
    const r = repo();
    await r.createRun({ id: 'a', specId: 's1', status: 'planned' });
    await r.createRun({ id: 'b', specId: 's1', status: 'planned' });
    await r.updateRun({ id: 'a', specId: 's1', status: 'deployed' });
    expect(await r.findDeployedRunBySpec('s1')).toMatchObject({ id: 'a' });
    await expect(r.updateRun({ id: 'b', specId: 's1', status: 'deployed' }))
      .rejects.toMatchObject({ code: 'DEPLOYED_CONFLICT' });
  });
});

describe('InMemoryDeployRepository — append-only Steps/Audit + SafetyLock', () => {
  test('Run-Steps sind append-only (kein update/delete)', async () => {
    const r = repo();
    await r.appendRunStep({ id: 'st1', runId: 'run1', step: 'clone', status: 'ok' });
    expect(await r.listRunSteps('run1')).toHaveLength(1);
    expect(typeof r.updateRunStep).not.toBe('function');
    expect(typeof r.deleteRunStep).not.toBe('function');
  });

  test('Audit append + list', async () => {
    const r = repo();
    await r.appendDeployAudit({ id: 'au1', type: 'deploy.started', runId: 'run1' });
    expect(await r.listDeployAudit()).toHaveLength(1);
  });

  test('SafetyLock get/set', async () => {
    const r = repo();
    expect((await r.getSafetyLock()).locked).toBe(false);
    await r.setSafetyLock(true, 'safe-stop');
    expect(await r.getSafetyLock()).toMatchObject({ locked: true, reason: 'safe-stop' });
  });
});
