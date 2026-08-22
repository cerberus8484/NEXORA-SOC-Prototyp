'use strict';

// P_CORR_ADMIN_2 Stufe 2 — PostgresApplyRepository: Mapping + Konflikt-/Transaktions-
// Vertrag OHNE echte DB (pool/query gemockt).

jest.mock('../../src/db/pool', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return { query: jest.fn(), pool: { connect: jest.fn(async () => client) }, __client: client };
});

const poolMod = require('../../src/db/pool');
const { query } = poolMod;
const { PostgresApplyRepository } = require('../../src/applyChannel/PostgresApplyRepository');

const repo = new PostgresApplyRepository();

describe('createRun — Konflikt-Normalisierung', () => {
  beforeEach(() => query.mockReset());

  test('Unique-Violation + aktiver Run vorhanden → ACTIVE_RUN_CONFLICT', async () => {
    const dup = new Error('dup'); dup.code = '23505';
    query
      .mockRejectedValueOnce(dup) // INSERT scheitert
      .mockResolvedValueOnce({ rows: [{ id: 'R0', plan_id: 'P', status: 'applying', started_by: 'a', started_at: new Date() }] }); // findActiveRun
    await expect(repo.createRun({ id: 'R1', planId: 'P', status: 'applying', startedBy: 'a', startedAt: 'x' }))
      .rejects.toMatchObject({ code: 'ACTIVE_RUN_CONFLICT' });
  });

  test('Unique-Violation ohne aktiven Run → PLAN_ALREADY_APPLIED', async () => {
    const dup = new Error('dup'); dup.code = '23505';
    query.mockRejectedValueOnce(dup).mockResolvedValueOnce({ rows: [] }); // kein aktiver Run
    await expect(repo.createRun({ id: 'R1', planId: 'P', status: 'applying', startedBy: 'a', startedAt: 'x' }))
      .rejects.toMatchObject({ code: 'PLAN_ALREADY_APPLIED' });
  });
});

describe('writeRuntimeConfig — Transaktion deactivate→insert', () => {
  test('BEGIN → UPDATE active=false → INSERT neue Version → COMMIT, release', async () => {
    const client = poolMod.__client;
    client.query.mockReset();
    client.query
      .mockResolvedValueOnce({ rows: [] })                 // BEGIN
      .mockResolvedValueOnce({ rows: [] })                 // UPDATE deactivate
      .mockResolvedValueOnce({ rows: [{ next: 3 }] })      // MAX(version)+1
      .mockResolvedValueOnce({ rows: [{ id: 'rc', capability_id: 'c', target_id: 't', value: { maxChildren: 9 }, version: 3, applied_by: 'a', active: true, created_at: new Date() }] }) // INSERT
      .mockResolvedValueOnce({ rows: [] });                // COMMIT
    client.release.mockReset();

    const out = await repo.writeRuntimeConfig({ capabilityId: 'c', targetId: 't', value: { maxChildren: 9 }, appliedBy: 'a' });
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => /UPDATE runtime_config SET active=FALSE/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO runtime_config/.test(s))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(out.version).toBe(3);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('applyRepositoryFactory', () => {
  test('ohne DB_ENABLED → InMemory', () => {
    jest.resetModules();
    const prev = process.env.DB_ENABLED; delete process.env.DB_ENABLED;
    try {
      const { createApplyRepository } = require('../../src/applyChannel/applyRepositoryFactory');
      const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');
      expect(createApplyRepository()).toBeInstanceOf(InMemoryApplyRepository);
    } finally { if (prev !== undefined) process.env.DB_ENABLED = prev; jest.resetModules(); }
  });
});
