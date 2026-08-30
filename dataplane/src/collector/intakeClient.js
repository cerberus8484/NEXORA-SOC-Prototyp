'use strict';

// HTTP-Transport für den Collector-Runner: macht aus einem EventEnvelopeV1 ein
// POST an den Intake-Endpoint. Bewusst als `emit(env)` geformt → passt direkt in
// `runCollectorPipeline({ emit })` und ist gegen einen Fake-Fetch testbar.
//
// Disziplin: ein einzelner Zustell-Fehler bricht den Stream NICHT ab — er wird an
// `onError` gemeldet (Logging/Metrik), der Runner verarbeitet die nächste Zeile.
// Persistente Queue/Retry macht der Go-Collector; dieser leichte Sensor ist
// best-effort (der Kernel/conntrack ist die Quelle der Wahrheit).

/**
 * @param {{
 *   url: string,                 // Intake-Events-URL
 *   credential: string,          // x-collector-credential
 *   fetchImpl?: typeof fetch,    // injizierbar für Tests
 *   onError?: (info: { status?: number, error?: string, eventId?: string }) => void
 * }} opts
 * @returns {(env: object) => Promise<void>} emit
 */
function createIntakeEmitter({ url, credential, fetchImpl = fetch, onError } = {}) {
  if (!url) throw new Error('createIntakeEmitter: url required');
  if (!credential) throw new Error('createIntakeEmitter: credential required');
  const report = typeof onError === 'function' ? onError : () => {};

  return async function emit(env) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-collector-credential': credential },
        body: JSON.stringify(env),
      });
      // 202 accepted · 200 duplicate (idempotent) → beides Erfolg.
      if (res.status !== 202 && res.status !== 200) {
        report({ status: res.status, eventId: env && env.eventId });
      }
    } catch (err) {
      report({ error: err && err.message ? err.message : String(err), eventId: env && env.eventId });
    }
  };
}

module.exports = { createIntakeEmitter };
