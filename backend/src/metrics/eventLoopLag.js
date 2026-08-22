'use strict';

// P_STABILITY_1 · Task 1 — Event-Loop-Lag-Messung.
// Idee: ein Timer wird alle resolutionMs geplant. Feuert er SPÄTER als erwartet,
// ist die Differenz der Lag — der Loop war blockiert (CPU-Stau, sync-Arbeit, GC).
// schedule/hrtimeMs sind injizierbar → deterministisch testbar. Das reale Wiring
// nutzt einen unref'd setInterval (hält den Prozess NICHT am Leben).

function defaultHrtimeMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function defaultSchedule(fn, ms) {
  const timer = setInterval(fn, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

function createEventLoopLagMonitor({ resolutionMs = 1000, hrtimeMs = defaultHrtimeMs, schedule = defaultSchedule } = {}) {
  let lagMs = 0;
  let prev = null;
  let stop = null;

  function sample() {
    const now = hrtimeMs();
    if (prev !== null) {
      // Zeit über die erwartete Resolution hinaus = Lag (nie negativ).
      lagMs = Math.max(0, (now - prev) - resolutionMs);
    }
    prev = now;
  }

  function start() {
    if (stop) return monitor; // idempotent — kein doppelter Timer
    prev = hrtimeMs();
    stop = schedule(sample, resolutionMs);
    return monitor;
  }

  function close() {
    if (stop) { stop(); stop = null; }
  }

  function getLagSeconds() {
    return lagMs / 1000;
  }

  const monitor = { start, close, getLagSeconds };
  return monitor;
}

// Singleton — wird in server.js gestartet; in Tests ungestartet (Lag bleibt 0).
const eventLoopLagMonitor = createEventLoopLagMonitor();

module.exports = { createEventLoopLagMonitor, eventLoopLagMonitor };
