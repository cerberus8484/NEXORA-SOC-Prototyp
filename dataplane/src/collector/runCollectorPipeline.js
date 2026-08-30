'use strict';

// Runner: führt einen Collector über Roh-Items aus → normalize → Envelope → validate → emit.
// `emit` ist injiziert (HTTP-Client zum Intake, oder Test-Sammler) → transport-entkoppelt.
// `rawItems` darf sync- ODER async-iterierbar sein (Array, Generator, stdin/Replay-Stream)
// — `for await` konsumiert beides.
// Disziplin: NIE einen ungültigen Envelope emittieren; `normalize`→null = bewusst verworfen.
const { buildEnvelope } = require('./buildEnvelope');
const { validateEnvelope } = require('../contract/eventEnvelopeV1');

/**
 * @param {object} collector  Plugin (siehe collectorRegistry)
 * @param {Iterable} rawItems  Roh-Datensätze der Quelle
 * @param {{ emit:(env:object)=>Promise<void>|void, now?:string, makeEventId?:(item:any)=>string }} ctx
 * @returns {Promise<{emitted:number, skipped:number, invalid:number}>}
 */
async function runCollectorPipeline(collector, rawItems, { emit, now, makeEventId } = {}) {
  if (typeof emit !== 'function') throw new Error('runCollectorPipeline: emit function required');
  const stats = { emitted: 0, skipped: 0, invalid: 0 };
  for await (const item of rawItems || []) {
    let part;
    try {
      part = collector.normalize(item);
    } catch {
      stats.invalid += 1; // Parser-Fehler bricht den Lauf NICHT
      continue;
    }
    if (!part) { stats.skipped += 1; continue; } // Noise/irrelevant → bewusst verworfen
    const env = buildEnvelope(collector, part, { eventId: makeEventId ? makeEventId(item) : undefined, now });
    if (!validateEnvelope(env).valid) { stats.invalid += 1; continue; }
    await emit(env);
    stats.emitted += 1;
  }
  return stats;
}

module.exports = { runCollectorPipeline };
