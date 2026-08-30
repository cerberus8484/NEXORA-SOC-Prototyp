'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const { registry } = require('../metrics/metricsRegistry');

const router = Router();

// Optionaler Scrape-Token (Defense-in-Depth ZUSÄTZLICH zum IP-Gate). Wenn METRICS_TOKEN
// gesetzt ist, muss der Scraper `Authorization: Bearer <token>` mitsenden. Default (ungesetzt)
// = nur IP-Gate → kein Verhaltenswechsel. Timing-sicherer Vergleich über SHA-256.
function metricsTokenOk(req) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return true; // Token-Schutz nicht aktiviert
  const authz = req.headers.authorization || '';
  const provided = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Grafana scrapt /metrics ohne Token. Statt offener Exposition: nur interne
// Quellen erlauben (Grafana-LXC 10.99.99.x + lokaler Loopback). Alles andere 403.
// 10.x = Lab-VLANs (internes RFC-1918-Netz), 172.16-31.x = Docker-interne Netze (nginx→api).
// 192.168.240.x ist der WAN-seitige FritzBox-Bereich → KEIN Zugriff auf /metrics.
const INTERNAL_PREFIXES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.',
  '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Prüft, ob eine Client-IP als intern gilt.
 * Behandelt IPv4-mapped IPv6 (::ffff:10.99.99.5) transparent.
 * @param {string} ip
 * @returns {boolean}
 */
function isInternalIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.replace(/^::ffff:/, '');
  if (LOOPBACK.has(ip) || LOOPBACK.has(clean)) return true;
  return INTERNAL_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

// GET /metrics — Prometheus-Textformat. IP-gated + optional Token-gated.
router.get('/', async (req, res, next) => {
  if (!isInternalIp(req.ip)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'metrics endpoint is internal-only' });
  }
  if (!metricsTokenOk(req)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'metrics endpoint requires a valid token' });
  }
  try {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(await registry.metrics());
  } catch (err) {
    next(err);
  }
});

module.exports = { router, isInternalIp, metricsTokenOk };
