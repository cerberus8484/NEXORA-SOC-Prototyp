'use strict';

// P_STABILITY_1 · Task 1 — wrappt einen Job-Handler mit Hintergrund-Metriken:
//   in_flight (inc/dec, auch bei Fehler), processed_total{result}, last_success.
// Der Fehler wird WEITERGEWORFEN → das Queue-Verhalten (Retry/Status) bleibt unberührt.
// Rein/injizierbar → ohne Queue oder echte Metriken testbar.
function instrumentJob(handler, { inFlight, processed, lastSuccess, now = () => Date.now() / 1000 }) {
  return async (job) => {
    inFlight.inc();
    try {
      const result = await handler(job);
      processed.inc({ result: 'completed' });
      lastSuccess.set(now());
      return result;
    } catch (err) {
      processed.inc({ result: 'failed' });
      throw err;
    } finally {
      inFlight.dec();
    }
  };
}

module.exports = { instrumentJob };
