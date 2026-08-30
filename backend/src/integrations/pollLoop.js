'use strict';

// P_STABILITY_2 · 3.2 — wiederverwendbarer, überlappungssicherer Poll-Loop.
//   Overlap-Guard: läuft ein Poll noch, wird der nächste Tick übersprungen (kein
//                  paralleles Anwachsen von Poll-Läufen).
//   Timeout:       ein hängender Lauf wird zeitlich begrenzt (timeoutMs; 0 = aus).
//   Backoff:       nach Fehlern werden Ticks bis backoffUntil ausgelassen
//                  (exponentiell, gedeckelt; maxBackoffMs=0 = aus).
//   Status:        running/inFlight/lastSuccessAt/lastErrorAt/lastError/runs/
//                  failures/skipsOverlap/timeouts — sichtbar + messbar.
//   Kein stiller Fehler: jeder Fehlschlag wird geloggt + gezählt.
// schedule/now injizierbar → deterministisch testbar; real ein unref'd setInterval.

function defaultSchedule(fn, ms) {
  const timer = setInterval(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return Promise.resolve(promise);
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('poll_timeout')), ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
  return Promise.race([
    Promise.resolve(promise).then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); throw e; }),
    timeout,
  ]);
}

function createPollLoop({ name, intervalMs, run, timeoutMs = 0, maxBackoffMs = 0, logger = console, schedule = defaultSchedule, now = Date.now } = {}) {
  if (typeof run !== 'function') throw new Error('createPollLoop benötigt run()');

  let inFlight = false;
  let stop = null;
  let backoffUntil = 0;
  let consecutiveFailures = 0;
  const status = {
    name, running: false, inFlight: false,
    lastSuccessAt: null, lastErrorAt: null, lastError: null,
    runs: 0, failures: 0, skipsOverlap: 0, timeouts: 0,
  };

  async function tick() {
    if (inFlight) { status.skipsOverlap += 1; logger.warn('poll_overlap_skipped', { poller: name }); return; }
    if (backoffUntil && now() < backoffUntil) return; // im Backoff → Tick auslassen

    inFlight = true; status.inFlight = true; status.runs += 1;
    try {
      await withTimeout(run(), timeoutMs);
      status.lastSuccessAt = now();
      consecutiveFailures = 0;
      backoffUntil = 0;
    } catch (err) {
      status.failures += 1;
      status.lastErrorAt = now();
      status.lastError = err && err.message;
      if (err && err.message === 'poll_timeout') status.timeouts += 1;
      consecutiveFailures += 1;
      if (maxBackoffMs > 0) {
        const backoff = Math.min(maxBackoffMs, intervalMs * Math.pow(2, Math.min(consecutiveFailures, 6)));
        backoffUntil = now() + backoff;
      }
      logger.error('poll_failed', { poller: name, message: status.lastError, consecutiveFailures });
    } finally {
      inFlight = false; status.inFlight = false;
    }
  }

  function start() {
    if (stop) return api; // idempotent — kein doppelter Timer
    status.running = true;
    stop = schedule(tick, intervalMs);
    return api;
  }
  function stopLoop() {
    if (stop) { stop(); stop = null; }
    status.running = false;
  }
  function getStatus() { return { ...status }; }

  const api = { start, stop: stopLoop, getStatus, tick };
  return api;
}

module.exports = { createPollLoop };
