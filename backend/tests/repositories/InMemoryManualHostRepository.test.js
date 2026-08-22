'use strict';

// InMemoryManualHostRepository — Vertrag: save / findAll / findById / delete.

const { InMemoryManualHostRepository } = require('../../src/repositories/ManualHostRepository');
const { ManualHost } = require('../../src/domain/ManualHost');

function repo() { return new InMemoryManualHostRepository(); }

describe('InMemoryManualHostRepository', () => {
  test('save + findAll liefert den Host zurück', async () => {
    const r = repo();
    const h = ManualHost.create({ hostname: 'fw-edge' });
    await r.save(h);
    const all = await r.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].hostname).toBe('fw-edge');
  });

  test('findById findet nach id, sonst null', async () => {
    const r = repo();
    const h = ManualHost.create({ hostname: 'sw01' });
    await r.save(h);
    expect((await r.findById(h.id)).hostname).toBe('sw01');
    expect(await r.findById('nope')).toBeNull();
  });

  test('delete entfernt und meldet true/false', async () => {
    const r = repo();
    const h = ManualHost.create({ hostname: 'nas01' });
    await r.save(h);
    expect(await r.delete(h.id)).toBe(true);
    expect(await r.findById(h.id)).toBeNull();
    expect(await r.delete(h.id)).toBe(false);
  });

  test('findAll ist nach createdAt sortiert (stabil)', async () => {
    const r = repo();
    // Explizite Zeitstempel über den Konstruktor (create() setzt createdAt = jetzt).
    await r.save(new ManualHost({ id: 'id-a', hostname: 'a', createdAt: '2026-01-01T00:00:00.000Z' }));
    await r.save(new ManualHost({ id: 'id-b', hostname: 'b', createdAt: '2026-02-01T00:00:00.000Z' }));
    const all = await r.findAll();
    expect(all.map((h) => h.hostname)).toEqual(['a', 'b']);
  });
});
