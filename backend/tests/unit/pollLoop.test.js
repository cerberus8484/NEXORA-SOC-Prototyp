'use strict';

const { createPollLoop } = require('../../src/integrations/pollLoop');

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const capturing = () => { let cb; return { schedule: (fn) => { cb = fn; return () => {}; }, tick: () => cb() }; };

describe('createPollLoop', () => {
  it('Overlap-Guard: ein zweiter Tick wird übersprungen, solange ein Lauf läuft', async () => {
    const c = capturing();
    let resolveRun;
    const run = jest.fn(() => new Promise((r) => { resolveRun = r; }));
    const loop = createPollLoop({ name: 't', intervalMs: 1000, run, logger: silent, schedule: c.schedule });
    loop.start();

    c.tick();          // Lauf 1 startet (inFlight)
    c.tick();          // Lauf 2 → übersprungen
    expect(run).toHaveBeenCalledTimes(1);
    expect(loop.getStatus().skipsOverlap).toBe(1);

    resolveRun();
    await Promise.resolve();
  });

  it('Erfolg setzt lastSuccessAt und zählt runs', async () => {
    const c = capturing();
    let t = 5000;
    const loop = createPollLoop({ name: 't', intervalMs: 1000, run: async () => {}, logger: silent, schedule: c.schedule, now: () => t });
    loop.start();
    await c.tick();
    const s = loop.getStatus();
    expect(s.runs).toBe(1);
    expect(s.lastSuccessAt).toBe(5000);
    expect(s.failures).toBe(0);
  });

  it('Fehler + Backoff: nächster Tick im Backoff-Fenster wird ausgelassen', async () => {
    const c = capturing();
    let t = 1000;
    const run = jest.fn().mockRejectedValue(new Error('fail'));
    const loop = createPollLoop({ name: 'b', intervalMs: 1000, run, maxBackoffMs: 60000, logger: silent, schedule: c.schedule, now: () => t });
    loop.start();

    await c.tick();                       // Fehler 1 → backoffUntil = 1000 + 2000 = 3000
    expect(run).toHaveBeenCalledTimes(1);
    expect(loop.getStatus().failures).toBe(1);

    t = 2000; await c.tick();             // im Backoff (<3000) → ausgelassen
    expect(run).toHaveBeenCalledTimes(1);

    t = 3500; await c.tick();             // Backoff vorbei → läuft erneut
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('Timeout: ein hängender Lauf wird begrenzt und als timeout gezählt', async () => {
    const c = capturing();
    const loop = createPollLoop({ name: 'to', intervalMs: 1000, run: () => new Promise(() => {}), timeoutMs: 10, logger: silent, schedule: c.schedule });
    loop.start();
    await c.tick();
    const s = loop.getStatus();
    expect(s.failures).toBe(1);
    expect(s.timeouts).toBe(1);
    expect(s.lastError).toBe('poll_timeout');
  });

  it('start ist idempotent + stop beendet den Timer', () => {
    let calls = 0; let stopped = false;
    const loop = createPollLoop({ name: 's', intervalMs: 1000, run: async () => {}, logger: silent, schedule: () => { calls++; return () => { stopped = true; }; } });
    loop.start();
    loop.start();
    expect(calls).toBe(1);
    loop.stop();
    expect(stopped).toBe(true);
    expect(loop.getStatus().running).toBe(false);
  });
});
