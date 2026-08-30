'use strict';

// Schlankes In-Memory Fixed-Window Rate-Limit für den Intake (Burst-Schutz, ADR-035-Security-Gate).
// Bewusst dependency-frei (Intake bleibt minimal) — ein Endpoint, interne Collector-Quellen.
// Pro IP ein Fenster; großzügiges Default-Limit blockiert nur Floods, keine legitimen Quellen.
// Für Multi-Instance/Prod-Härtung wäre ein geteilter Zähler (Redis) der nächste Schritt.

const DEFAULTS = { limit: 6000, windowMs: 60000 }; // 6000 req/min/IP

/**
 * @param {{ limit?:number, windowMs?:number, now?:()=>number }} opts
 * @returns Express-Middleware
 */
function createRateLimiter({ limit = DEFAULTS.limit, windowMs = DEFAULTS.windowMs, now = Date.now } = {}) {
  const buckets = new Map(); // ip → { windowStart, count }
  return function rateLimit(req, res, next) {
    const ip = (req && req.ip) || 'unknown';
    const t = now();
    let b = buckets.get(ip);
    if (!b || (t - b.windowStart) >= windowMs) { b = { windowStart: t, count: 0 }; buckets.set(ip, b); }
    b.count += 1;
    if (b.count > limit) {
      return res.status(429).json({ status: 'rejected', rejectionCode: 'RATE_LIMITED' });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
