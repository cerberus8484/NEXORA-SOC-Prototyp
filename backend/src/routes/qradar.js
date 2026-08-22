'use strict';

const { Router }                      = require('express');
const { requireAuth, requireRole }    = require('../middleware/authenticate');
const { qradarDashboardProvider }     = require('../integrations/adapters/qradar/QRadarDashboardProvider');
const { OffenseNote }                 = require('../integrations/adapters/qradar/OffenseNote');
const { offenseNoteRepository }       = require('../integrations/adapters/qradar/offenseNoteRepositoryFactory');
const { ValidationError }             = require('../errors/AppError');

// Layer 2: QRadar-Verbindung aus der UI verwalten.
const rateLimit = require('express-rate-limit');
const { authService }                 = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS }  = require('../services/AuditService');
const { createSettingsRepository }     = require('../repositories/settingsRepositoryFactory');
const { resolveQradarConnection, saveQradarConnection, maskedQradarConnection } = require('../services/qradarConnectionSettings');
const { applyQradarConnection }        = require('../integrations/adapters/qradar/qradarConnectionApplier');
const { qradarConnectionSchema }       = require('../domain/validation/qradarConnectionSchema');
const { QRadarDashboardProvider }      = require('../integrations/adapters/qradar/QRadarDashboardProvider');
const { isBlockedSsrfUrlResolved, ssrfBlockReason }     = require('../integrations/http/internalUrlAllowlist');
const { RealHttpClient }               = require('../integrations/http/RealHttpClient');
const { classifyConnError }            = require('../integrations/http/connErrorClassifier');
const logger                          = require('../logger');

// Kurzer Timeout für den Test-Pfad: ein Verbindungstest soll schnell scheitern
// (nicht 10s hängen), wenn der Host nicht routbar ist — bounded für UI + Tests.
const QRADAR_TEST_TIMEOUT_MS = 3000;

// Nur Host[:Port] fürs Audit — kein Token/Pfad.
const hostFromUrl = (url) => { try { return new URL(url).host; } catch { return ''; } };

const MAX_CONTENT_LENGTH = 5000;

const router = Router();
const settingsRepo = createSettingsRepository();

// Testbarer Probe-Seam: Default baut den echten Provider (RealHttpClient, geboundeter
// Timeout) und rekonfiguriert ihn auf die effektive Verbindung. Wird NIE über HTTP
// gesetzt — nur Tests injizieren via router.setProbeFactory() einen Fake-Probe, um die
// ok/Fehler-Pfade ohne Netzwerk zu prüfen. null/undefined stellt den Default wieder her.
const defaultQradarProbeFactory = ({ baseUrl, token }) => {
  const probe = new QRadarDashboardProvider({
    http: new RealHttpClient({ timeout: QRADAR_TEST_TIMEOUT_MS, rejectUnauthorized: process.env.QRADAR_TLS_REJECT_UNAUTHORIZED !== 'false', ssrfProtection: true }),
  });
  probe.reconfigure({ baseUrl, token });
  return probe;
};
let qradarProbeFactory = defaultQradarProbeFactory;
router.setProbeFactory = (fn) => { qradarProbeFactory = fn || defaultQradarProbeFactory; };

// Step-up-Limiter (Online-Passwort-Verifikation) — pro User, im Test inaktiv.
const connLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// GET /api/v1/qradar/stats
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const data = await qradarDashboardProvider.getStats();
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/qradar/offenses?filter=OPEN|ALL
router.get('/offenses', requireAuth, async (req, res, next) => {
  try {
    const filter = req.query.filter === 'ALL' ? 'ALL' : 'OPEN';
    const data = await qradarDashboardProvider.getOffenses(filter);
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// WICHTIG: /offenses/:id/notes VOR /offenses/:id registrieren — sonst matcht :id zuerst.

// GET /api/v1/qradar/offenses/:id/notes
router.get('/offenses/:id/notes', requireAuth, async (req, res, next) => {
  try {
    const notes = await offenseNoteRepository.listByOffense(req.params.id);
    res.json({ data: notes.map((n) => n.toJSON()), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/qradar/offenses/:id/notes
// author kommt aus req.user.sub (Token) — NICHT aus dem Body (Security: Privilege escalation prevention)
router.post(
  '/offenses/:id/notes',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const { content } = req.body;

      // Explizite Eingabe-Validierung vor Domain-Objekt-Erstellung
      if (!content || typeof content !== 'string' || !content.trim()) {
        return next(new ValidationError('content ist Pflichtfeld und darf nicht leer sein'));
      }
      if (content.trim().length > MAX_CONTENT_LENGTH) {
        return next(new ValidationError(`content darf maximal ${MAX_CONTENT_LENGTH} Zeichen lang sein`));
      }

      // author aus Token — nie aus Body lesen
      const author = req.user.sub;

      const note  = OffenseNote.create({ offenseId: req.params.id, content, author });
      const saved = await offenseNoteRepository.add(note);
      res.status(201).json({ data: saved.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/qradar/offenses/:id
router.get('/offenses/:id', requireAuth, async (req, res, next) => {
  try {
    const data = await qradarDashboardProvider.getOffense(req.params.id);
    if (!data) return res.status(404).json({ error: 'not_found', requestId: req.id });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/qradar/offenses/:id/events
router.get('/offenses/:id/events', requireAuth, async (req, res, next) => {
  try {
    const data = await qradarDashboardProvider.getOffenseEvents(req.params.id);
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// ── QRadar-Verbindung (Layer 2: Frontend-Administrierbarkeit) ─────────────────

// GET /api/v1/qradar/connection — maskiert (admin; nie Token).
router.get('/connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedQradarConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/qradar/connection — speichern (admin + Passwort-Step-up + Audit).
// Token leer = unverändert; leere Base-URL = Sektion löschen (→ ENV). Wirkt sofort.
router.put('/connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = qradarConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }
    // SSRF-Deny-List: QRadar darf on-prem (RFC-1918) ODER extern sein → keine
    // Allowlist möglich, aber Loopback/Link-local/Metadaten bleiben tabu.
    if (value.baseUrl !== '' && await isBlockedSsrfUrlResolved(value.baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }

    // Passwort-Step-up gegen den aktuellen User (fail-closed, kein Enumeration-Leak).
    const user = await authService._findById(req.user?.sub);
    const valid = user && user.passwordHash ? await authService.verifyPassword(value.password, user.passwordHash) : false;
    if (!valid) {
      await auditService.write({
        ...actor, action: AUDIT_ACTIONS.QRADAR_CONNECTION_CHANGE_DENIED,
        targetType: 'qradar_connection', targetId: 'qradar', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('qradar_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    try {
      await saveQradarConnection(settingsRepo, { baseUrl: value.baseUrl, token: value.token });
    } catch (err) {
      if (err.code === 'QRADAR_INCOMPLETE') {
        return res.status(400).json({ error: 'QRADAR_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }
    await applyQradarConnection(settingsRepo);

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.QRADAR_CONNECTION_CHANGED,
      targetType: 'qradar_connection', targetId: 'qradar',
      metadata: { baseUrlSet: value.baseUrl !== '', tokenSet: (value.token || '') !== '' },
    });

    res.json({ data: await maskedQradarConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/qradar/connection/test — Verbindungstest ohne Speichern (admin).
// Leere Felder → effektive Verbindung (DB > ENV). Nicht konfiguriert → not_configured.
// Defense-in-Depth (Security-Review): Rate-Limit + Audit + SSRF-Deny-List, damit der
// Endpoint kein unbeschränktes SSRF-/Scan-Orakel gegen beliebige https-Hosts wird.
router.post('/connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  try {
    const bodyUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    if (bodyUrl !== '' && !/^https:\/\//i.test(bodyUrl)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'QRadar-URL muss https sein.', requestId: req.id });
    }
    // Blockieren bleibt fail-closed — aber der GRUND wird benannt: ein nicht
    // auflösbarer Hostname als „Loopback/Metadaten" zu melden schickt den Admin
    // auf die falsche Fährte (der häufigste Fall ist ein Tippfehler oder fehlendes
    // DNS im Nexora-Container, nicht ein SSRF-Versuch).
    const ssrfReason = bodyUrl !== '' ? await ssrfBlockReason(bodyUrl) : null;
    if (ssrfReason) {
      return res.status(400).json(ssrfReason === 'unresolvable'
        ? { error: 'UNRESOLVABLE_HOST', message: 'Hostname nicht auflösbar — Schreibweise prüfen bzw. DNS des Nexora-Containers.', requestId: req.id }
        : { error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    const eff = await resolveQradarConnection(settingsRepo);
    const targetChanged = bodyUrl !== '' && bodyUrl.replace(/\/+$/, '') !== String(eff.baseUrl || '').replace(/\/+$/, '');
    const hasBodyToken = typeof req.body?.token === 'string' && req.body.token.trim() !== '';
    if (targetChanged && !hasBodyToken) {
      return res.status(400).json({ error: 'CREDENTIAL_TARGET_MISMATCH', message: 'Bei geaendertem Ziel muss der Token neu angegeben werden.', requestId: req.id });
    }
    const baseUrl = bodyUrl !== '' ? bodyUrl : eff.baseUrl;
    const token = typeof req.body?.token === 'string' && req.body.token.trim() !== '' ? req.body.token.trim() : eff.token;
    if (baseUrl && await isBlockedSsrfUrlResolved(baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    if (!baseUrl || !token) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    const probe = qradarProbeFactory({ baseUrl, token });
    const t0 = Date.now();
    let result;
    try {
      await probe.ping();
      result = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // Rohen Fehler nur serverseitig loggen; dem Client nur eine sichere Kategorie (kein Info-Disclosure).
      logger.warn('qradar_conn_test_probe_failed', { host: hostFromUrl(baseUrl), error: err.message });
      result = { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
    }
    // Jeder Test wird auditiert — nur Ziel-Host + Ergebnis, NIE der Token.
    await auditService.write({
      actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '',
      action: AUDIT_ACTIONS.QRADAR_CONNECTION_TEST, targetType: 'qradar_connection', targetId: 'qradar',
      metadata: { host: hostFromUrl(baseUrl), ok: result.ok },
    }).catch((e) => logger.error('qradar_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
