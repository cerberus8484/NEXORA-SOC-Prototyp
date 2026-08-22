'use strict';

// RAG Status + Reindex — Backend-only.
// GET  /api/v1/rag/status   — requireAuth (fail-safe, crasht nie)
// POST /api/v1/rag/reindex  — requireRole('admin'), fire-and-forget

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const logger             = require('../logger');
const { RealHttpClient } = require('../integrations/http/RealHttpClient');
const { OllamaEmbedder } = require('../rag/OllamaEmbedder');
const { QdrantClient }   = require('../rag/QdrantClient');
const { RagIngestionService } = require('../rag/RagIngestionService');
const config = require('../config');
const { query } = require('../db/pool');

// Layer 2: Qdrant-Verbindung aus der UI verwalten.
const rateLimit = require('express-rate-limit');
const { authService }                 = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS }  = require('../services/AuditService');
const { createSettingsRepository }     = require('../repositories/settingsRepositoryFactory');
const { resolveQdrantConnection, saveQdrantConnection, maskedQdrantConnection } = require('../services/qdrantConnectionSettings');
const { applyQdrantConnection }        = require('../rag/qdrantConnectionApplier');
const { qdrantConnectionSchema }       = require('../domain/validation/qdrantConnectionSchema');
const { isInternalHttpUrl }            = require('../integrations/http/internalUrlAllowlist');
const { classifyConnError }            = require('../integrations/http/connErrorClassifier');

const router = Router();
const settingsRepo = createSettingsRepository();

const RAG_ENABLED = process.env.RAG_ENABLED === 'true';
const COLLECTION  = 'mitre_attack';

const hostFromUrl = (url) => { try { return new URL(url).host; } catch { return ''; } };

const qdrantConnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// Fail-safe Qdrant-Status — wirft nie.
// Wichtig: Erreichbarkeit über die Collections-LISTE prüfen (existiert solange Qdrant
// lebt). Die Ziel-Collection separat — ein 404 darauf bedeutet "Collection fehlt /
// nicht indexiert", NICHT "Qdrant nicht erreichbar" (das war der alte Bug).
async function probeQdrant() {
  if (!RAG_ENABLED) return { reachable: false, collectionExists: false, vectorCount: null };
  const http = new RealHttpClient({ timeout: 3000, rejectUnauthorized: process.env.QDRANT_TLS_REJECT_UNAUTHORIZED === 'true' });
  // Effektive Verbindung (DB > ENV) — Status spiegelt die UI-Konfiguration.
  // Fail-safe (diese Funktion wirft NIE): ein DB-Hänger beim Settings-Read darf
  // /status nicht auf 500 kippen → Fallback auf ENV/Default.
  let conn;
  try {
    conn = await resolveQdrantConnection(settingsRepo);
  } catch (_err) {
    conn = { url: (process.env.QDRANT_URL || 'http://127.0.0.1:6333'), apiKey: process.env.QDRANT_API_KEY || '' };
  }
  const baseUrl = conn.url.replace(/\/$/, '');
  const headers = conn.apiKey ? { 'api-key': conn.apiKey } : {};

  // 1) Erreichbarkeit
  try {
    await http.request(`${baseUrl}/collections`, { method: 'GET', headers });
  } catch (_err) {
    return { reachable: false, collectionExists: false, vectorCount: null };
  }

  // 2) Ziel-Collection (404 = fehlt, nicht unreachable)
  try {
    const res = await http.request(`${baseUrl}/collections/${encodeURIComponent(COLLECTION)}`, { method: 'GET', headers });
    const r = res.data?.result || {};
    const vectorCount = r.points_count ?? r.vectors_count ?? 0;
    return { reachable: true, collectionExists: true, vectorCount };
  } catch (_err) {
    return { reachable: true, collectionExists: false, vectorCount: null };
  }
}

// ── GET /api/v1/rag/status ──────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  if (!RAG_ENABLED) {
    return res.json({ enabled: false, qdrantReachable: false, collectionExists: false, collection: COLLECTION, vectorCount: null, requestId: req.id });
  }
  const { reachable, collectionExists, vectorCount } = await probeQdrant();
  return res.json({ enabled: true, qdrantReachable: reachable, collectionExists, collection: COLLECTION, vectorCount, requestId: req.id });
});

// ── POST /api/v1/rag/reindex — admin, fire-and-forget ───────────────────────
// Reindexiert Hunts + (bei DB) abgeschlossene High/Critical-Incidents.
// MITRE-Bundle bleibt CLI-Aufgabe. Anonymisierung im RagIngestionService.
router.post('/reindex', requireAuth, requireRole('admin'), async (req, res) => {
  if (!RAG_ENABLED) {
    return res.status(409).json({ error: 'RAG_DISABLED', message: 'RAG_ENABLED ist nicht gesetzt — Reindex nicht möglich.', requestId: req.id });
  }

  res.status(202).json({ message: 'Reindex gestartet.', requestId: req.id });

  setImmediate(async () => {
    try {
      const embedder = new OllamaEmbedder({});
      const qdrant   = new QdrantClient({});
      const svc      = new RagIngestionService({ embedder, qdrant });

      const huntsCount = await svc.ingestHunts();
      logger.info('rag_reindex_hunts', { count: huntsCount });

      if (config.db && config.db.enabled) {
        const dbRes = await query(
          `SELECT id, ticket_number AS "ticketNumber", title, analysis AS description,
                  '' AS mitre, priority AS severity
             FROM tickets
            WHERE status = 'closed' AND priority IN ('high', 'critical')
            LIMIT 1000`,
        );
        const incidentsCount = await svc.ingestIncidents(dbRes.rows);
        logger.info('rag_reindex_incidents', { count: incidentsCount });
      }
      logger.info('rag_reindex_complete');
    } catch (err) {
      logger.error('rag_reindex_failed', { message: err.message });
    }
  });
});

// ── Qdrant-Verbindung (Layer 2: Frontend-Administrierbarkeit) ─────────────────

// GET /api/v1/rag/qdrant-connection — maskiert (admin; nie Key).
router.get('/qdrant-connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedQdrantConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/rag/qdrant-connection — speichern (admin + Passwort-Step-up + Audit).
// Key optional/leer = unverändert; leere URL = Sektion löschen (→ ENV). Wirkt sofort.
router.put('/qdrant-connection', requireAuth, requireRole('admin'), qdrantConnLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = qdrantConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }
    // Qdrant ist ein interner Vektor-Store → nur interne Ziele (localhost/RFC-1918).
    if (value.url !== '' && !isInternalHttpUrl(value.url)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'Qdrant-URL muss auf einen internen Host zeigen (localhost, RFC-1918).', requestId: req.id });
    }

    const user = await authService._findById(req.user?.sub);
    const valid = user && user.passwordHash ? await authService.verifyPassword(value.password, user.passwordHash) : false;
    if (!valid) {
      await auditService.write({
        ...actor, action: AUDIT_ACTIONS.QDRANT_CONNECTION_CHANGE_DENIED,
        targetType: 'qdrant_connection', targetId: 'qdrant', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('qdrant_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    await saveQdrantConnection(settingsRepo, { url: value.url, apiKey: value.apiKey });
    await applyQdrantConnection(settingsRepo);

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.QDRANT_CONNECTION_CHANGED,
      targetType: 'qdrant_connection', targetId: 'qdrant',
      metadata: { urlSet: value.url !== '', apiKeySet: (value.apiKey || '') !== '' },
    });

    res.json({ data: await maskedQdrantConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/rag/qdrant-connection/test — Verbindungstest ohne Speichern (admin).
router.post('/qdrant-connection/test', requireAuth, requireRole('admin'), qdrantConnLimiter, async (req, res, next) => {
  try {
    const bodyUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (bodyUrl !== '' && !isInternalHttpUrl(bodyUrl)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'Qdrant-URL muss auf einen internen Host zeigen (localhost, RFC-1918).', requestId: req.id });
    }
    const eff = await resolveQdrantConnection(settingsRepo);
    const url = bodyUrl !== '' ? bodyUrl : eff.url;
    const apiKey = typeof req.body?.apiKey === 'string' && req.body.apiKey.trim() !== '' ? req.body.apiKey.trim() : eff.apiKey;

    const probe = new QdrantClient({ url, apiKey });
    const t0 = Date.now();
    let result;
    try {
      await probe.ping();
      result = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // Rohen Fehler nur serverseitig loggen; dem Client nur eine sichere Kategorie (kein Info-Disclosure).
      logger.warn('qdrant_conn_test_probe_failed', { host: hostFromUrl(url), error: err.message });
      result = { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
    }
    await auditService.write({
      ...{ actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' },
      action: AUDIT_ACTIONS.QDRANT_CONNECTION_TEST, targetType: 'qdrant_connection', targetId: 'qdrant',
      metadata: { host: hostFromUrl(url), ok: result.ok },
    }).catch((e) => logger.error('qdrant_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
