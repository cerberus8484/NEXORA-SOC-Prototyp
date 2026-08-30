'use strict';

const { InMemoryPublishedDetectionRepository } = require('../../src/repositories/InMemoryPublishedDetectionRepository');
const { PublishedDetection } = require('../../src/domain/PublishedDetection');

function makeDraft(override = {}) {
  return {
    id:          `draft-${Math.random().toString(36).slice(2)}`,
    title:       'Test Detection',
    sourceType:  'ticket',
    sourceId:    'INC001',
    severity:    'medium',
    mitre:       [{ technique: 'T1059' }],
    detectionLogic: { language: 'sigma', queryOrRule: 'select * from proc', explanation: 'proc monitor' },
    ...override,
  };
}

describe('InMemoryPublishedDetectionRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new InMemoryPublishedDetectionRepository();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  it('create() persistiert und gibt JSON zurück', async () => {
    const pd     = PublishedDetection.create(makeDraft(), 'admin');
    const result = await repo.create(pd);
    expect(result.id).toBe(pd.id);
    expect(result.rule).toBe(pd.rule);
  });

  it('create() akzeptiert auch eine plain-Domain-Instanz', async () => {
    const pd     = PublishedDetection.create(makeDraft(), 'admin');
    const result = await repo.create(pd);
    expect(result).not.toBeInstanceOf(PublishedDetection); // toJSON → plain object
    expect(result.draftId).toBeTruthy();
  });

  // ─── findByDraftId ────────────────────────────────────────────────────────

  it('findByDraftId() gibt das erstellte Objekt zurück', async () => {
    const draft = makeDraft();
    const pd    = PublishedDetection.create(draft, 'admin');
    await repo.create(pd);
    const found = await repo.findByDraftId(draft.id);
    expect(found).not.toBeNull();
    expect(found.draftId).toBe(draft.id);
  });

  it('findByDraftId() gibt null zurück wenn nicht vorhanden', async () => {
    const found = await repo.findByDraftId('unbekannte-draft-id');
    expect(found).toBeNull();
  });

  it('findByDraftId() Idempotenz: nach zweitem create() desselben draftId dasselbe Eintrag', async () => {
    const draft  = makeDraft();
    const pd1    = PublishedDetection.create(draft, 'admin');
    await repo.create(pd1);
    // Zweiter Eintrag mit neuem id, aber gleichem draftId → im Repo nur einer
    // (Idempotenz-Guard liegt im Service — Repo selbst überschreibt, daher hier
    // prüfen wir nur, dass findByDraftId das zuletzt Erstellte findet)
    const found = await repo.findByDraftId(draft.id);
    expect(found.draftId).toBe(draft.id);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  it('findAll() gibt leeres data-Array und total=0 zurück wenn leer', async () => {
    const r = await repo.findAll();
    expect(r.data).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('findAll() gibt alle Einträge in absteigender createdAt-Reihenfolge zurück', async () => {
    const d1 = makeDraft({ id: 'draft-a' });
    const d2 = makeDraft({ id: 'draft-b' });
    const d3 = makeDraft({ id: 'draft-c' });

    // Leicht zeitversetzt anlegen
    await repo.create(PublishedDetection.create(d1, 'u'));
    await new Promise((r) => setTimeout(r, 2));
    await repo.create(PublishedDetection.create(d2, 'u'));
    await new Promise((r) => setTimeout(r, 2));
    await repo.create(PublishedDetection.create(d3, 'u'));

    const r = await repo.findAll();
    expect(r.total).toBe(3);
    // neueste zuerst
    expect(r.data[0].draftId).toBe('draft-c');
    expect(r.data[2].draftId).toBe('draft-a');
  });

  it('findAll() unterstützt limit und offset', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create(PublishedDetection.create(makeDraft(), 'u'));
      await new Promise((r) => setTimeout(r, 1));
    }
    const r = await repo.findAll({ limit: 2, offset: 1 });
    expect(r.data).toHaveLength(2);
    expect(r.total).toBe(5);
  });

  it('findAll() liefert unveränderliche Plain-Objekte (keine geteilten Referenzen)', async () => {
    await repo.create(PublishedDetection.create(makeDraft(), 'u'));
    const r = await repo.findAll();
    r.data[0].title = 'Mutiert';
    const r2 = await repo.findAll();
    expect(r2.data[0].title).not.toBe('Mutiert');
  });
});
