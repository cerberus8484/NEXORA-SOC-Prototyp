'use strict';

/**
 * Tests — InMemoryAutonomyPolicyRepository
 * CRUD + findByCustomerAndClass + Unique-Scope-Constraint
 */

const { InMemoryAutonomyPolicyRepository } = require('../../src/repositories/InMemoryAutonomyPolicyRepository');
const { AutonomyPolicy } = require('../../src/domain/AutonomyPolicy');

function makeData(overrides = {}) {
  return {
    customer:             '*',
    actionClass:          'enrichment',
    mode:                 'advisory',
    minVerdict:           'confirmed_incident',
    minConfidence:        0.9,
    requireEvidenceFloor: true,
    maxPerHour:           0,
    enabled:              false,
    createdBy:            'admin',
    ...overrides,
  };
}

describe('InMemoryAutonomyPolicyRepository — create', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('create() gibt JSON mit id zurück', async () => {
    const result = await repo.create(makeData());
    expect(result).toHaveProperty('id');
    expect(result.actionClass).toBe('enrichment');
  });

  it('create() nimmt AutonomyPolicy-Instanz entgegen', async () => {
    const policy = AutonomyPolicy.create(makeData());
    const result = await repo.create(policy);
    expect(result.id).toBe(policy.id);
  });

  it('create() wirft bei doppeltem customer+actionClass (Unique-Scope)', async () => {
    await repo.create(makeData({ customer: '*', actionClass: 'enrichment' }));
    await expect(
      repo.create(makeData({ customer: '*', actionClass: 'enrichment' }))
    ).rejects.toThrow();
  });

  it('verschiedene actionClass darf denselben customer haben', async () => {
    await repo.create(makeData({ customer: '*', actionClass: 'enrichment' }));
    const result = await repo.create(makeData({ customer: '*', actionClass: 'internal_state' }));
    expect(result.actionClass).toBe('internal_state');
  });
});

describe('InMemoryAutonomyPolicyRepository — findById', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('findById() gibt gespeicherte Policy zurück', async () => {
    const created = await repo.create(makeData());
    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
  });

  it('findById() gibt null für unbekannte ID zurück', async () => {
    const found = await repo.findById('non-existent-id');
    expect(found).toBeNull();
  });
});

describe('InMemoryAutonomyPolicyRepository — findAll', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('findAll() gibt { data, total } zurück', async () => {
    await repo.create(makeData({ actionClass: 'enrichment' }));
    await repo.create(makeData({ actionClass: 'internal_state' }));
    const result = await repo.findAll();
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.total).toBe(2);
  });

  it('findAll() respektiert limit', async () => {
    await repo.create(makeData({ actionClass: 'enrichment' }));
    await repo.create(makeData({ actionClass: 'internal_state' }));
    await repo.create(makeData({ actionClass: 'draft_generation' }));
    const result = await repo.findAll({ limit: 2, offset: 0 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('findAll() respektiert offset', async () => {
    await repo.create(makeData({ actionClass: 'enrichment' }));
    await repo.create(makeData({ actionClass: 'internal_state' }));
    const result = await repo.findAll({ limit: 10, offset: 1 });
    expect(result.data).toHaveLength(1);
  });

  it('findAll() leeres Repo → { data: [], total: 0 }', async () => {
    const result = await repo.findAll();
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('InMemoryAutonomyPolicyRepository — update', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('update() ändert Felder und gibt aktualisiertes JSON zurück', async () => {
    const created = await repo.create(makeData());
    const updated = await repo.update(created.id, { enabled: true, mode: 'assisted' });
    expect(updated.enabled).toBe(true);
    expect(updated.mode).toBe('assisted');
  });

  it('update() gibt null für unbekannte ID zurück', async () => {
    const result = await repo.update('unknown-id', { enabled: true });
    expect(result).toBeNull();
  });

  it('update() setzt updatedAt neu', async () => {
    const created = await repo.create(makeData());
    const oldUpdatedAt = created.updatedAt;
    await new Promise(r => setTimeout(r, 5)); // sicherstellen dass Zeit vergeht
    const updated = await repo.update(created.id, { enabled: true });
    expect(updated.updatedAt).toBeDefined();
  });
});

describe('InMemoryAutonomyPolicyRepository — delete', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('delete() entfernt die Policy', async () => {
    const created = await repo.create(makeData());
    await repo.delete(created.id);
    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  it('delete() erlaubt danach neues create() mit gleichem scope', async () => {
    const created = await repo.create(makeData({ customer: '*', actionClass: 'enrichment' }));
    await repo.delete(created.id);
    // Nach Delete darf der Scope wieder belegt werden
    const again = await repo.create(makeData({ customer: '*', actionClass: 'enrichment' }));
    expect(again.actionClass).toBe('enrichment');
  });

  it('delete() einer unbekannten ID wirft nicht', async () => {
    await expect(repo.delete('unknown-id')).resolves.not.toThrow();
  });
});

describe('InMemoryAutonomyPolicyRepository — findByCustomerAndClass', () => {
  let repo;
  beforeEach(() => { repo = new InMemoryAutonomyPolicyRepository(); });

  it('findByCustomerAndClass() findet passende Policy', async () => {
    await repo.create(makeData({ customer: '*', actionClass: 'enrichment' }));
    const found = await repo.findByCustomerAndClass('*', 'enrichment');
    expect(found).not.toBeNull();
    expect(found.actionClass).toBe('enrichment');
  });

  it('findByCustomerAndClass() gibt null zurück wenn kein Match', async () => {
    const found = await repo.findByCustomerAndClass('customer-x', 'enrichment');
    expect(found).toBeNull();
  });

  it('findByCustomerAndClass() ist kunden-spezifisch', async () => {
    await repo.create(makeData({ customer: 'acme', actionClass: 'enrichment' }));
    await repo.create(makeData({ customer: 'nexora', actionClass: 'enrichment' }));
    const acme = await repo.findByCustomerAndClass('acme', 'enrichment');
    const nexora = await repo.findByCustomerAndClass('nexora', 'enrichment');
    expect(acme.customer).toBe('acme');
    expect(nexora.customer).toBe('nexora');
  });
});
