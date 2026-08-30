'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Korrelator als eigenständiger Container (Deployment-Phase 2).
//
// Bisher lief der Korrelations-Worker IM API-Prozess. Für den Docker-Schnitt
// braucht die Runtime zwei Rollen:
//
//   • API-Rolle    → Queue starten (zum EINREIHEN via Schedule-on-Read) +
//                    Scheduler + Repo — aber KEIN Worker.
//   • Worker-Rolle → Queue starten + Worker registrieren (verarbeitet Jobs).
//
// Wichtig: Die API braucht die Queue weiterhin, weil `GET /tickets/:id/evidence`
// bei fehlendem Ergebnis einen Job plant. Nur das Verarbeiten zieht um.
//
// Rückwärtskompatibel: ohne Angabe bleibt der Worker AN (heutiges Verhalten) —
// eine bestehende Installation ohne Worker-Container korreliert unverändert
// weiter. Erst das `full`-Profil schaltet ihn in der API ab und startet den
// eigenen Container.
// ─────────────────────────────────────────────────────────────────────────

const { InMemoryCorrelationRepository } = require('../../src/repositories/InMemoryCorrelationRepository');
const { InMemoryQueueService } = require('../../src/queue/InMemoryQueueService');
const { buildCorrelationRuntime } = require('../../src/correlation/correlationRuntime');

const makeTickets = () => ({
  getById:      jest.fn(async (id) => ({ id, kind: 'alert', updatedAt: 'rev1' })),
  findChildren: jest.fn(async () => []),
  getRevision:  jest.fn(async () => 'rev1'),
});

const makeQueue = () => ({
  start:          jest.fn(async () => {}),
  registerWorker: jest.fn(async () => {}),
  enqueue:        jest.fn(async () => {}),
  stats:          jest.fn(async () => ({})),
});

const build = (queue, extra = {}) => buildCorrelationRuntime({
  queue, repo: new InMemoryCorrelationRepository(),
  engine: { correlate: () => ({}) }, tickets: makeTickets(), ...extra,
});

describe('correlationRuntime — Rollen (API vs. Worker-Container)', () => {
  test('Default: Worker läuft mit (unverändertes Verhalten bestehender Installationen)', async () => {
    const queue = makeQueue();
    const rt = build(queue);

    await rt.start();

    expect(queue.start).toHaveBeenCalled();
    expect(queue.registerWorker).toHaveBeenCalled();   // Worker registriert
    expect(rt.isStarted()).toBe(true);
  });

  test('API-Rolle (enableWorker:false): Queue JA, Worker NEIN', async () => {
    const queue = makeQueue();
    const rt = build(queue, { enableWorker: false });

    await rt.start();

    // Queue muss laufen — die API reiht per Schedule-on-Read Jobs ein.
    expect(queue.start).toHaveBeenCalled();
    // Aber sie darf KEINE Jobs verarbeiten (das macht der eigene Container).
    expect(queue.registerWorker).not.toHaveBeenCalled();
    expect(rt.isStarted()).toBe(true);
  });

  test('API-Rolle behält Scheduler + Repo (Schedule-on-Read funktioniert weiter)', () => {
    const queue = makeQueue();
    const rt = build(queue, { enableWorker: false });

    expect(rt.scheduler).toBeTruthy();
    expect(rt.repo).toBeTruthy();
    expect(rt.scheduler._queue).toBe(queue);           // reiht in DIESELBE Queue ein
  });

  test('stop() ist in der API-Rolle gefahrlos (kein Worker zu stoppen)', async () => {
    const queue = makeQueue();
    const rt = build(queue, { enableWorker: false });
    await rt.start();

    await expect(rt.stop()).resolves.not.toThrow();
    expect(rt.isStarted()).toBe(false);
  });

  test('Worker-Rolle meldet sich als solche (für Logs/Diagnose unterscheidbar)', () => {
    expect(build(makeQueue(), { enableWorker: true }).workerEnabled).toBe(true);
    expect(build(makeQueue(), { enableWorker: false }).workerEnabled).toBe(false);
  });
});
