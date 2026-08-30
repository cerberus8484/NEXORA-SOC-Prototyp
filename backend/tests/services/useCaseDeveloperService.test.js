'use strict';

const { UseCaseDeveloperService }        = require('../../src/services/UseCaseDeveloperService');
const { InMemoryUseCaseDraftRepository } = require('../../src/repositories/InMemoryUseCaseDraftRepository');
const { StubUseCaseDeveloperProvider }   = require('../../src/agents/usecase/StubUseCaseDeveloperProvider');
const { validateUseCaseDraft }           = require('../../src/services/UseCaseQualityValidator');

function svc(over = {}) {
  return new UseCaseDeveloperService({
    repo: new InMemoryUseCaseDraftRepository(),
    provider: new StubUseCaseDeveloperProvider(),
    validator: validateUseCaseDraft,
    ...over,
  });
}

describe('UseCaseDeveloperService — Konstruktor', () => {
  it('wirft ohne repo/provider/validator', () => {
    expect(() => new UseCaseDeveloperService()).toThrow('repo erforderlich');
    expect(() => new UseCaseDeveloperService({ repo: {} })).toThrow('provider');
    expect(() => new UseCaseDeveloperService({ repo: {}, provider: { develop() {} } })).toThrow('validator');
  });
});

describe('UseCaseDeveloperService — generate', () => {
  it('erzeugt einen Draft (status=draft) + Quality-Report und speichert ihn', async () => {
    const s = svc();
    const r = await s.generate({ sourceType: 'ticket', sourceId: 'INC1', actor: { id: 'u1', role: 'analyst' } });
    expect(r.draft.id).toBeDefined();
    expect(r.draft.status).toBe('draft');
    expect(r.draft.sourceType).toBe('ticket');
    expect(r.draft.sourceId).toBe('INC1');
    expect(r.draft.generatedBy).toBeTruthy(); // Stub: 'stub', Ollama: 'ollama'
    expect(r.quality).toHaveProperty('passed');
    expect(r.quality).toHaveProperty('checks');
    const list = await s.list();
    expect(list.total).toBe(1);
  });

  it('vergibt eine fortlaufende UC-INC-Nummer bei der Erstellung', async () => {
    const s = svc();
    const r1 = await s.generate({ sourceType: 'ticket', sourceId: 'INC1' });
    const r2 = await s.generate({ sourceType: 'manual', sourceId: '' });
    expect(r1.draft.ucNumber).toBe('UC-INC000001');
    expect(r2.draft.ucNumber).toBe('UC-INC000002');
    expect(r1.draft.ucNumber).toMatch(/^UC-INC\d{6}$/);
  });

  it('LLM-Fehler des Providers wird NICHT verschluckt', async () => {
    const failing = { develop: async () => { throw Object.assign(new Error('ollama down'), { status: 503 }); } };
    const s = svc({ provider: failing });
    await expect(s.generate({ sourceType: 'manual', sourceId: '' })).rejects.toThrow('ollama down');
  });
});

describe('UseCaseDeveloperService — Lifecycle (human-in-the-loop)', () => {
  it('draft → review → approve → publish über die Domain-Übergänge', async () => {
    const s = svc();
    const { draft } = await s.generate({ sourceType: 'ticket', sourceId: 'INC2' });
    const reviewed = await s.sendToReview(draft.id, { id: 'a1' });
    expect(reviewed.status).toBe('in_review');
    const approved = await s.approve(draft.id, { id: 'eng1' });
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('eng1');
    const published = await s.publish(draft.id, { id: 'adm1' });
    expect(published.status).toBe('published');
  });

  it('ungültiger Übergang wirft 409 (draft → approve direkt)', async () => {
    const s = svc();
    const { draft } = await s.generate({ sourceType: 'manual', sourceId: '' });
    await expect(s.approve(draft.id, { id: 'eng1' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('Transition auf unbekannter ID → 404', async () => {
    await expect(svc().sendToReview('nope', {})).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reject setzt status rejected', async () => {
    const s = svc();
    const { draft } = await s.generate({ sourceType: 'manual', sourceId: '' });
    await s.sendToReview(draft.id, {});
    const rejected = await s.reject(draft.id, { id: 'eng1' });
    expect(rejected.status).toBe('rejected');
  });
});
