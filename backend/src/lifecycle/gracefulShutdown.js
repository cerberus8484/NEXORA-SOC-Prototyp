'use strict';

// P_STABILITY_1 · Task 4 — ordentliches Herunterfahren.
// Schließt Ressourcen in definierter Reihenfolge, FEHLER-ISOLIERT (ein hängender/
// fehlschlagender Closer blockiert die übrigen nicht) und GESAMT-ZEITBEGRENZT
// (Force-Exit, falls etwas hängt → Container wird nie vom Host-OOM/Kill überrascht).
// Idempotent (mehrfaches Signal = ein Shutdown). Rein/injizierbar → testbar.
function createGracefulShutdown({
  closers = [],
  logger,
  exit = process.exit,
  timeoutMs = 10000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let started = false;

  async function shutdown(signal) {
    if (started) return;        // idempotent
    started = true;
    logger.info('shutdown_start', { signal });

    // Hartes Zeitlimit: hängt ein Closer, beenden wir den Prozess trotzdem (Code 1).
    const forceTimer = setTimeoutFn(() => {
      logger.error('shutdown_forced', { reason: 'timeout', timeoutMs });
      exit(1);
    }, timeoutMs);
    if (forceTimer && typeof forceTimer.unref === 'function') forceTimer.unref();

    for (const c of closers) {
      try {
        await c.close();
        logger.info('shutdown_closed', { resource: c.name });
      } catch (err) {
        // Sichtbar machen, aber die übrigen Closer trotzdem ausführen (kein stiller Fehler).
        logger.error('shutdown_close_failed', { resource: c.name, message: err && err.message });
      }
    }

    clearTimeoutFn(forceTimer);
    logger.info('shutdown_done', { signal });
    exit(0);
  }

  return { shutdown };
}

module.exports = { createGracefulShutdown };
