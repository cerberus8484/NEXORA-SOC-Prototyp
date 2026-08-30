'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Stream-Pull-Quelle (ADR-036) für laufende Logs: ein read-only `tail -F` auf der
// Quelle (z.B. cowrie.json/eve.json), dessen stdout der interne Hub zeilenweise zieht.
// Kontinuierlich, niedrigste Latenz (kein Intervall). Self-Healing: bricht der Stream ab
// (Verbindung/tail tot), wird mit Backoff neu geöffnet. Stop über AbortSignal.
//
// `openStream({signal})` ist injiziert und liefert ein async-iterables von String/Buffer-
// Chunks (Prod: stdout von `ssh … tail -n0 -F <pfad>`) → testbar ohne echtes SSH.
// Zeilen werden über Chunk-Grenzen hinweg zusammengesetzt; CR wird gestrippt, Leerzeilen
// verworfen. Liefert ein async-Iterable von Zeilen → speist unverändert runCollectorPipeline.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_RECONNECT_MS = 2000;

function defaultWait(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    let settled = false;
    let onAbort = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const t = setTimeout(finish, ms);
    t.unref?.();
    if (!signal) return;
    onAbort = () => {
      clearTimeout(t);
      finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {{
 *   openStream: (ctx:{signal?:AbortSignal}) => Promise<AsyncIterable>|AsyncIterable,
 *   reconnectWaitMs?: number,
 *   wait?: (ms:number, signal?:AbortSignal) => Promise<void>,
 *   signal?: AbortSignal, onError?: (err:Error) => void
 * }} opts
 * @returns {AsyncGenerator<string>} Zeilen
 */
function createRemoteTailSource({ openStream, reconnectWaitMs = DEFAULT_RECONNECT_MS, wait = defaultWait, signal, onError } = {}) {
  if (typeof openStream !== 'function') throw new Error('remoteTailSource: openStream required');

  return (async function* tail() {
    while (!(signal && signal.aborted)) {
      let stream;
      try {
        stream = await openStream({ signal });
      } catch (err) {
        if (onError) onError(err);
        if (signal && signal.aborted) return;
        await wait(reconnectWaitMs, signal);   // Öffnen fehlgeschlagen → Backoff, dann erneut
        continue;
      }

      let buf = '';
      try {
        for await (const chunk of stream) {
          if (signal && signal.aborted) return;
          buf += String(chunk);
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (line.length) yield line;       // Leerzeilen bewusst verwerfen
          }
        }
        // Stream regulär zu Ende = Verbindung/tail beendet → unten Reconnect.
      } catch (err) {
        if (onError) onError(err);             // Stream-Fehler bricht NICHT ab
      }
      // Partieller Rest (Zeile ohne abschließendes \n) wird bewusst verworfen; bei Reconnect frisch.
      if (signal && signal.aborted) return;
      await wait(reconnectWaitMs, signal);
    }
  })();
}

module.exports = { createRemoteTailSource, DEFAULT_RECONNECT_MS };
