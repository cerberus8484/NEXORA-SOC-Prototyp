'use strict';

const { UseCaseDeveloperService }              = require('../../src/services/UseCaseDeveloperService');
const { InMemoryUseCaseDraftRepository }       = require('../../src/repositories/InMemoryUseCaseDraftRepository');
const { InMemoryPublishedDetectionRepository } = require('../../src/repositories/InMemoryPublishedDetectionRepository');
const { StubUseCaseDeveloperProvider }         = require('../../src/agents/usecase/StubUseCaseDeveloperProvider');
const { validateUseCaseDraft }                 = require('../../src/services/UseCaseQualityValidator');

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

function svc({ detectionRepo = null } = {}) {
  return new UseCaseDeveloperService({
    repo:          new InMemoryUseCaseDraftRepository(),
    provider:      new StubUseCaseDeveloperProvider(),
    validator:     validateUseCaseDraft,
    detectionRepo,
  });
}

async function publishedDraft(s) {
  const { draft } = await s.generate({ sourceType: 'manual', sourceId: 'x' });
  await s.sendToReview(draft.id, { id: 'u1' });
  await s.approve(draft.id, { id: 'u2' });
  return draft;
}

// ─── Publish erzeugt Detection-Eintrag ────────────────────────────────────────

describe('UseCaseDeveloperService — publish mit detectionRepo', () => {
  it('publish erzeugt genau einen PublishedDetection-Eintrag', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    await s.publish(draft.id, { id: 'admin1' });

    const { data, total } = await detectionRepo.findAll();
    expect(total).toBe(1);
    expect(data[0].draftId).toBe(draft.id);
  });

  it('publish übernimmt die UC-INC-Nummer des Drafts in die Detection', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    await s.publish(draft.id, { id: 'admin1' });

    const { data } = await detectionRepo.findAll();
    expect(draft.ucNumber).toMatch(/^UC-INC\d{6}$/);
    expect(data[0].ucNumber).toBe(draft.ucNumber);
  });

  it('publish setzt rule aus detectionLogic.queryOrRule', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);
    const full          = await s.get(draft.id);

    await s.publish(draft.id, { id: 'admin1' });

    const { data } = await detectionRepo.findAll();
    // Stub liefert eine queryOrRule — prüfe dass sie übernommen wurde
    expect(data[0].rule).toBe(full.detectionLogic?.queryOrRule ?? '');
  });

  it('publish setzt publishedBy auf actor.id', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    await s.publish(draft.id, { id: 'admin42' });

    const { data } = await detectionRepo.findAll();
    expect(data[0].publishedBy).toBe('admin42');
  });

  it('DSGVO: Detection-Eintrag enthält keine testCases', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    await s.publish(draft.id, { id: 'admin1' });

    const { data } = await detectionRepo.findAll();
    expect(data[0]).not.toHaveProperty('testCases');
  });
});

// ─── Idempotenz ───────────────────────────────────────────────────────────────

describe('UseCaseDeveloperService — publish Idempotenz', () => {
  it('doppelter publish-Aufruf desselben Drafts erzeugt KEINEN zweiten Detection-Eintrag', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    await s.publish(draft.id, { id: 'admin1' });

    // Zweiter Aufruf: Draft ist bereits published → Domain wirft 409 (erlaubter Übergang
    // published→published existiert nicht). Der Service fängt das intern ab.
    // Erwartung: kein zweiter Detection-Eintrag
    try { await s.publish(draft.id, { id: 'admin1' }); } catch (_) { /* 409 erwartet */ }

    const { total } = await detectionRepo.findAll();
    expect(total).toBe(1);
  });

  it('wenn detectionRepo bereits einen Eintrag für draftId hat → keinen zweiten anlegen', async () => {
    const detectionRepo = new InMemoryPublishedDetectionRepository();
    const s             = svc({ detectionRepo });
    const draft         = await publishedDraft(s);

    // Ersten Eintrag manuell anlegen
    const { PublishedDetection } = require('../../src/domain/PublishedDetection');
    const existing = PublishedDetection.create({ ...draft, id: draft.id }, 'admin0');
    await detectionRepo.create(existing);

    // Jetzt publish: sollte idempotent sein, kein zweiter Eintrag
    await s.publish(draft.id, { id: 'admin1' });

    const { total } = await detectionRepo.findAll();
    expect(total).toBe(1);
  });
});

// ─── Ohne detectionRepo — bestehende Tests bleiben grün ───────────────────────

describe('UseCaseDeveloperService — publish OHNE detectionRepo (Abwärtskompatibilität)', () => {
  it('publish ohne detectionRepo ändert nur den Status (kein Fehler)', async () => {
    const s     = svc({ detectionRepo: null });
    const draft = await publishedDraft(s);

    const result = await s.publish(draft.id, { id: 'admin1' });
    expect(result.status).toBe('published');
  });

  it('generate+list funktionieren ohne detectionRepo wie bisher', async () => {
    const s = svc();
    const { draft } = await s.generate({ sourceType: 'manual', sourceId: '' });
    expect(draft.status).toBe('draft');
    const list = await s.list();
    expect(list.total).toBe(1);
  });
});
