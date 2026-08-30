'use strict';

// Erkennt ID-artige Pfadsegmente (UUIDs, numerische IDs, lange Hex/alphanumerische Tokens).
// Ziel: Kardinalitäts-Explosion in Prometheus vermeiden — /v1/tickets/<id> wird zu /v1/tickets/:id.
const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE     = /^\d+$/;
const ALNUM_RE       = /^[0-9a-z]+$/i;
const HAS_DIGIT_RE   = /\d/;

function looksLikeId(segment) {
  if (!segment) return false;
  if (UUID_RE.test(segment)) return true;
  if (NUMERIC_RE.test(segment)) return true;
  // Alphanumerische Tokens mit Ziffer und Mindestlänge 4 (z.B. abc123, Hashes,
  // Slug-IDs) sind IDs. So bleiben API-Version-Segmente wie "v1" und reine Wörter
  // ohne Ziffer (sources, webhook, tickets) erhalten — der Label-Raum bleibt
  // lesbar und kardinalitäts-stabil. Rein numerische IDs deckt NUMERIC_RE oben ab.
  if (segment.length >= 4 && ALNUM_RE.test(segment) && HAS_DIGIT_RE.test(segment)) return true;
  return false;
}

/**
 * Normalisiert einen Request-Pfad für stabile Metrik-Labels.
 * /v1/tickets/abc123 → /v1/tickets/:id
 * @param {string} path
 * @returns {string}
 */
function normalizeRoute(path) {
  if (!path || typeof path !== 'string') return '/';
  const [pathname] = path.split('?');
  const normalized = pathname
    .split('/')
    .map((seg) => (looksLikeId(seg) ? ':id' : seg))
    .join('/');
  return normalized || '/';
}

module.exports = { normalizeRoute, looksLikeId };
