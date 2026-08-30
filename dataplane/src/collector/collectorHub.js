'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Collector-Hub (ADR-036) — EIN System, das N Kollektoren NEBENLÄUFIG fährt.
// Jeder Collector zieht aus seiner Pull-Quelle (createPollSource/Stream) und
// emittiert über EINEN gemeinsamen Intake-Emitter. Pro Collector ein Live-Status.
//
// Reine Orchestrierung: `makeCollector`, `makeSource`, `emit` sind injiziert
// (Prod-Defaults = buildCollector + reale Pull-Transporte, im Hub-Entrypoint
// verdrahtet) → testbar ohne SSH/HTTP/Intake. Erweiterbar: ein spec-Eintrag mehr.
//
// spec = { name (eindeutig), kind?, …config (z.B. source/schedule/scope/credentialRef) }
// Isolation: Fehler EINES Collectors (Setup oder Quelle) kippt die anderen NICHT.
// Stop: AbortSignal an start() → alle Pull-Quellen beenden sauber.
// ─────────────────────────────────────────────────────────────────────────

const { runCollectorPipeline } = require('./runCollectorPipeline');

/**
 * @param {{
 *   specs: Array<{name:string}>,
 *   makeCollector: (spec) => object,                 // → Collector-Plugin
 *   makeSource: (spec, ctx:{signal?:AbortSignal}) => Iterable|AsyncIterable,
 *   emit: (env:object, spec?:object) => Promise<void>|void,
 *   onError?: (err:Error, spec:object) => void
 * }} opts
 */
function createCollectorHub({ specs = [], makeCollector, makeSource, emit, onError } = {}) {
  if (typeof makeCollector !== 'function') throw new Error('collectorHub: makeCollector required');
  if (typeof makeSource !== 'function') throw new Error('collectorHub: makeSource required');
  if (typeof emit !== 'function') throw new Error('collectorHub: emit required');

  const states = new Map();
  for (const spec of specs) {
    const name = spec && spec.name;
    if (!name || typeof name !== 'string') throw new Error('collectorHub: jeder spec braucht einen name');
    if (states.has(name)) throw new Error(`collectorHub: name muss eindeutig sein (duplicate: ${name})`);
    states.set(name, { name, kind: spec.kind || null, status: 'pending', emitted: 0, error: null, stats: null });
  }

  let started = false;
  const runners = [];

  function start({ signal } = {}) {
    if (started) throw new Error('collectorHub: bereits gestartet');
    started = true;
    for (const spec of specs) {
      const st = states.get(spec.name);
      st.status = 'running';
      const runner = Promise.resolve().then(() => {
        const collector = makeCollector(spec);                 // Setup-Fehler → isoliert (catch unten)
        const source = makeSource(spec, { signal });
        const countingEmit = async (env) => { st.emitted += 1; await emit(env, spec); };
        return runCollectorPipeline(collector, source, { emit: countingEmit });
      }).then((stats) => {
        st.stats = stats;
        st.status = signal && signal.aborted ? 'stopped' : 'completed';
      }).catch((err) => {
        st.status = 'failed';
        st.error = err && err.message ? err.message : String(err);
        if (onError) onError(err, spec);
      });
      runners.push(runner);
    }
    return hub;
  }

  function status() {
    return [...states.values()].map((s) => ({ ...s }));
  }

  // Wartet, bis alle Runner beendet sind (für endliche Quellen/Tests bzw. nach Abort).
  function wait() {
    return Promise.allSettled(runners);
  }

  const hub = { start, status, wait };
  return hub;
}

module.exports = { createCollectorHub };
