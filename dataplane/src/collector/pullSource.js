'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Pull-Quelle für den internen Collector-Hub (ADR-036). Der Kollektor läuft INTERN
// und HOLT die Daten von der (ggf. feindlichen) Quelle — read-only, automatisch.
//
// createPollSource = Intervall-Poll mit Cursor (für API-Quellen: Firewall/SIEM).
//   - `intervalMs` ist die Stellschraube: Sekunden bis Millisekunden (Enterprise).
//     Echtes ms-Polling einer API hämmert die Quelle — für niedrigste Latenz nimmt
//     man Stream/Long-Poll (eigene Quelle), nicht ein winziges Intervall.
//   - `fetchSince(cursor)` ist der injizierte Transport (SSH-Query/HTTP/DB) → testbar.
//   - Cursor = „nur Neues seit zuletzt"; kein Doppel-Ingest, kein Verlust.
//   - Fehler der Quelle brechen NICHT ab (Self-Healing): onError + nächster Zyklus.
//   - Stop über AbortSignal.
//
// Liefert ein async-Iterable → speist unverändert `runCollectorPipeline`.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 5000;

function defaultWait(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * @param {{
 *   fetchSince: (cursor:any) => Promise<{records:any[], cursor?:any}>,
 *   intervalMs?: number, startCursor?: any,
 *   wait?: (ms:number, signal?:AbortSignal) => Promise<void>,
 *   signal?: AbortSignal, onError?: (err:Error) => void
 * }} opts
 * @returns {AsyncGenerator} Records, wie die Quelle sie liefert
 */
function createPollSource({ fetchSince, intervalMs = DEFAULT_INTERVAL_MS, startCursor = null, wait = defaultWait, signal, onError } = {}) {
  if (typeof fetchSince !== 'function') throw new Error('pullSource: fetchSince required');

  return (async function* poll() {
    let cursor = startCursor;
    while (!(signal && signal.aborted)) {
      try {
        const res = await fetchSince(cursor);
        const records = (res && res.records) || [];
        for (const r of records) {
          if (signal && signal.aborted) return;
          yield r;
        }
        if (res && res.cursor !== undefined) cursor = res.cursor; // Cursor nur bei echter Antwort fortschreiben
      } catch (err) {
        if (onError) onError(err);            // kein Crash, kein tight loop — Backoff = das normale Intervall
      }
      if (signal && signal.aborted) return;
      await wait(intervalMs, signal);
    }
  })();
}

module.exports = { createPollSource, DEFAULT_INTERVAL_MS };
