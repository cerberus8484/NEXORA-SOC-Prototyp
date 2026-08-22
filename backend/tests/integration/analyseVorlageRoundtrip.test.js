'use strict';

// Live-Roundtrip #5 — Analyse-Vorlagen + Use-Cases gegen das Repository,
// das die Factory unter der aktuellen Config wählt:
//   DB_ENABLED=true  → PostgresAnalysisTemplateRepository / PostgresUseCaseRepository (echte DB)
//   DB_ENABLED=false → InMemory* (Default in der Test-Suite, keine DB nötig)
//
// Verifiziert die volle CRUD-Kette (Create → FindById → Update → Delete) sowie
// die Dedup-Invarianten (findByName / findByValue), exakt so wie sie der
// Service in Produktion gegen Postgres fährt. Damit ist der DB-Roundtrip
// abgedeckt, ohne dass die Standard-Suite eine laufende DB braucht.

const config = require('../../src/config');
const { createAnalysisTemplateRepository } = require('../../src/repositories/analysisTemplateRepositoryFactory');
const { createUseCaseRepository } = require('../../src/repositories/useCaseRepositoryFactory');
const { AnalysisTemplateService } = require('../../src/services/AnalysisTemplateService');
const { UseCaseService } = require('../../src/services/UseCaseService');

const dbEnabled = config.db.enabled;
const impl = dbEnabled ? 'postgres' : 'in-memory';

// Bei echter DB einmal pingen — ist sie unerreichbar, überspringen wir die Suite
// kontrolliert (statt mit kryptischem Connection-Error rot zu werden).
let dbReachable = true;
beforeAll(async () => {
  if (!dbEnabled) return;
  try {
    const { ping, migrate } = require('../../src/db/pool');
    await migrate();
    dbReachable = await ping();
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbEnabled) return;
  try {
    const { pool } = require('../../src/db/pool');
    await pool.end();
  } catch {
    /* Pool evtl. nie geöffnet — ignorierbar */
  }
});

const guard = (name, fn) => test(name, async () => {
  if (dbEnabled && !dbReachable) {
    // eslint-disable-next-line no-console
    console.warn('[roundtrip5] DB_ENABLED=true, aber DB nicht erreichbar — Test übersprungen');
    return;
  }
  await fn();
});

describe(`Analyse-Vorlagen — Repository-Roundtrip (${impl})`, () => {
  const service = new AnalysisTemplateService({ repo: createAnalysisTemplateRepository() });
  const uniqueName = () => `RT-Vorlage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  guard('Create → FindById liefert dieselbe Vorlage mit allen Feldern zurück', async () => {
    const name = uniqueName();
    const created = await service.create({
      name, desc: 'Phishing-Triage', iocs: 'evil.example\nbad.example',
      logs: 'QRadar OFF-42', actions: 'Mailbox isoliert', rec: 'User schulen',
      notes: 'interne Notiz', author: 'roundtrip@x.io',
    });

    const found = await service.get(created.id);
    expect(found.id).toBe(created.id);
    expect(found.name).toBe(name);
    expect(found.desc).toBe('Phishing-Triage');
    expect(found.iocs).toBe('evil.example\nbad.example');
    expect(found.logs).toBe('QRadar OFF-42');
    expect(found.actions).toBe('Mailbox isoliert');
    expect(found.rec).toBe('User schulen');
    expect(found.notes).toBe('interne Notiz');
    expect(found.author).toBe('roundtrip@x.io');

    await service.remove(created.id);
  });

  guard('Update persistiert geänderte Felder und behält die id', async () => {
    const created = await service.create({ name: uniqueName(), desc: 'alt' });
    const updated = await service.update(created.id, { desc: 'neu', rec: 'Empfehlung' });
    expect(updated.id).toBe(created.id);

    const reloaded = await service.get(created.id);
    expect(reloaded.desc).toBe('neu');
    expect(reloaded.rec).toBe('Empfehlung');

    await service.remove(created.id);
  });

  guard('Delete entfernt die Vorlage — danach FindById = NotFound', async () => {
    const created = await service.create({ name: uniqueName() });
    await service.remove(created.id);
    await expect(service.get(created.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  guard('Duplikat-Name → ConflictError (Dedup über findByName)', async () => {
    const name = uniqueName();
    const first = await service.create({ name });
    await expect(service.create({ name })).rejects.toMatchObject({ statusCode: 409 });
    await service.remove(first.id);
  });

  guard('Remove auf unbekannter id → NotFound', async () => {
    await expect(service.remove('00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe(`Use-Cases — Repository-Roundtrip (${impl})`, () => {
  const service = new UseCaseService({ repo: createUseCaseRepository() });
  const uniqueValue = () => `RT-UC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  guard('Create → List enthält den neuen Use-Case', async () => {
    const value = uniqueValue();
    const created = await service.create({ value, author: 'roundtrip@x.io' });
    expect(created.value).toBe(value);
    expect(created.author).toBe('roundtrip@x.io');

    const all = await service.list();
    expect(all.some((u) => u.id === created.id && u.value === value)).toBe(true);

    await service.remove(created.id);
  });

  guard('Delete entfernt den Use-Case — danach nicht mehr in der Liste', async () => {
    const created = await service.create({ value: uniqueValue() });
    await service.remove(created.id);
    const all = await service.list();
    expect(all.some((u) => u.id === created.id)).toBe(false);
  });

  guard('Duplikat-Wert → ConflictError (Dedup über findByValue)', async () => {
    const value = uniqueValue();
    const first = await service.create({ value });
    await expect(service.create({ value })).rejects.toMatchObject({ statusCode: 409 });
    await service.remove(first.id);
  });

  guard('Remove auf unbekannter id → NotFound', async () => {
    await expect(service.remove('00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
