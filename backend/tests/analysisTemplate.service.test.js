'use strict';

const { AnalysisTemplateService } = require('../src/services/AnalysisTemplateService');
const { InMemoryAnalysisTemplateRepository } = require('../src/repositories/InMemoryAnalysisTemplateRepository');

function makeService() {
  return new AnalysisTemplateService({ repo: new InMemoryAnalysisTemplateRepository() });
}

describe('AnalysisTemplateService', () => {
  test('create speichert eine Vorlage und vergibt ID', async () => {
    const svc = makeService();
    const t = await svc.create({ name: 'RDP Brute Force', desc: 'd', author: 'a@nexora' });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('RDP Brute Force');
    expect(t.author).toBe('a@nexora');
  });

  test('create ohne Namen wirft 400', async () => {
    const svc = makeService();
    await expect(svc.create({ name: '   ' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('create mit Duplikat-Namen wirft 409', async () => {
    const svc = makeService();
    await svc.create({ name: 'Phishing' });
    await expect(svc.create({ name: 'Phishing' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('list gibt neueste zuerst', async () => {
    const svc = makeService();
    const a = await svc.create({ name: 'A' });
    a.createdAt = '2020-01-01T00:00:00.000Z';
    await svc._repo.save(a);
    await svc.create({ name: 'B' });
    const all = await svc.list();
    expect(all[0].name).toBe('B');
  });

  test('update ändert Felder, behält ID', async () => {
    const svc = makeService();
    const t = await svc.create({ name: 'X', desc: 'alt' });
    const upd = await svc.update(t.id, { desc: 'neu', iocs: '1.2.3.4' });
    expect(upd.id).toBe(t.id);
    expect(upd.desc).toBe('neu');
    expect(upd.iocs).toBe('1.2.3.4');
    expect(upd.name).toBe('X');
  });

  test('update auf bestehenden Namen wirft 409', async () => {
    const svc = makeService();
    await svc.create({ name: 'A' });
    const b = await svc.create({ name: 'B' });
    await expect(svc.update(b.id, { name: 'A' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('update/get/remove auf unbekannte ID wirft 404', async () => {
    const svc = makeService();
    await expect(svc.update('nope', { desc: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.get('nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.remove('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('remove löscht die Vorlage', async () => {
    const svc = makeService();
    const t = await svc.create({ name: 'Z' });
    await svc.remove(t.id);
    expect(await svc.list()).toHaveLength(0);
  });
});
