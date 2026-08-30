'use strict';

// P_STABILITY_1 · Task 3b — gecachter, fehlersicherer DB-Health-Check.
// check() wirft NIE: liefert { db: 'ok' | 'error', error?, checkedAt }.
//   TTL-Cache    — viele /health-Aufrufe lösen nicht je einen DB-Ping aus.
//   Single-Flight— gleichzeitige Aufrufe teilen sich EINEN laufenden Ping.
//   withTimeout  — ein hängender Ping kippt nicht das ganze Health-Endpoint.
// Alles injizierbar (ping/now/withTimeout) → ohne laufende DB testbar.

// Begrenzt ein Promise zeitlich; lehnt mit 'health_ping_timeout' ab, wenn es hängt.
function defaultWithTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('health_ping_timeout')), ms);
  });
  const guarded = Promise.resolve(promise).then(
    (v) => { clearTimeout(timer); return v; },
    (e) => { clearTimeout(timer); throw e; },
  );
  return Promise.race([guarded, timeout]);
}

function createDbHealthChecker({ ping, ttlMs = 3000, timeoutMs = 2000, now = Date.now, withTimeout = defaultWithTimeout } = {}) {
  let cached = null;    // { db, error?, checkedAt }
  let inFlight = null;  // Promise<result>

  async function runCheck() {
    try {
      // ping() synchron starten (der try/catch fängt auch synchrone Throws),
      // damit Single-Flight greift, bevor der erste await die Kontrolle abgibt.
      await withTimeout(ping(), timeoutMs);
      return { db: 'ok', checkedAt: now() };
    } catch (err) {
      return { db: 'error', error: err instanceof Error ? err.message : String(err), checkedAt: now() };
    }
  }

  async function check() {
    if (cached && (now() - cached.checkedAt) < ttlMs) return cached;
    if (inFlight) return inFlight;
    inFlight = runCheck();
    try {
      cached = await inFlight;
    } finally {
      inFlight = null;
    }
    return cached;
  }

  return { check };
}

module.exports = { createDbHealthChecker, defaultWithTimeout };
