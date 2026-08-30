'use strict';

// Services-Control — Registry steuerbarer Infrastruktur-Dienste (admin-only).
//
// GET /services            — Katalog: welche Dienste steuerbar sind + ob ihr
//                            Restart aktuell möglich ist (ehrliche Begründung).
// POST /wazuh-manager/arm  — Restart per UI scharfschalten (admin + Passwort-Step-up).
// POST /wazuh-manager/disarm — entschärfen (admin; safe direction, kein Passwort).
// GET  /wazuh-connection      — Wazuh-Verbindung, maskiert (admin; NIE Passwörter).
// PUT  /wazuh-connection      — Verbindung speichern (admin + Passwort-Step-up + Audit).
// POST /wazuh-connection/test — Verbindungstest ohne Speichern (admin).
//
// Der EIGENTLICHE Neustart bleibt am bestehenden, gegateten Endpoint
// POST /wazuh/manager/restart (Gate + Config-Validierung + Audit) — hier wird
// NICHTS neu gestartet. arm/disarm setzen nur das persistierte Scharfschalt-Flag.

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const config = require('../config');
const { buildServiceControlCatalog } = require('../services/serviceControlCatalog');
const wazuhRestartArmStore = require('../services/wazuhRestartArmStore');
const { wazuhRestartArmSource } = require('../services/wazuhRestartArm');
const { authService } = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const logger = require('../logger');
const rateLimit = require('express-rate-limit');

// Layer 2: Wazuh-Verbindung aus der UI verwalten (DB > ENV, Passwörter verschlüsselt).
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { saveWazuhConnection, maskedWazuhConnection, resolveWazuhConnection } = require('../services/wazuhConnectionSettings');
const { applyWazuhConnection } = require('../integrations/adapters/wazuh/wazuhConnectionApplier');
const { isInternalHttpUrl } = require('../integrations/http/internalUrlAllowlist');
const wazuhConnectionTester = require('../services/wazuhConnectionTester');

const router = Router();

function isConnectionSectionConfigured(section) {
  return Boolean(
    section
    && typeof section.url === 'string'
    && section.url.trim() !== ''
    && typeof section.user === 'string'
    && section.user.trim() !== ''
    && typeof section.password === 'string'
    && section.password !== '',
  );
}

// Strenger Limiter fürs Scharfschalten: das ist ein Online-Passwort-Step-up
// (bcrypt.compare gegen den eigenen Hash). Ein gestohlenes Admin-JWT ohne
// Passwort darf NICHT unbegrenzt raten können (Brute-Force/Credential-Stuffing-
// Schutz). Pro User gekeyt (requireAuth läuft davor). Im Test inaktiv.
const armLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Scharfschalt-Versuche — bitte später erneut.' },
});

const armActor = (req) => ({
  actorUserId: req.user?.sub ?? null,
  actorLabel:  req.user?.email ?? 'unknown',
  ip:          req.ip || '',
});

// GET /api/v1/services — Katalog aus Live-Konfiguration + persistiertem Arm-Flag.
// admin-only: die Seite steuert sicherheitsrelevante Remote-Dienste.
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const dbArmed = await wazuhRestartArmStore.isArmed();
    const conn = await resolveWazuhConnection(settingsRepo);
    const apiConfigured = isConnectionSectionConfigured(conn.api);
    const indexerConfigured = isConnectionSectionConfigured(conn.indexer);
    const data = buildServiceControlCatalog({
      managerRestartEnabled: config.wazuh.managerRestartEnabled === true,
      managerRestartArmed: dbArmed,
      wazuhConnection: {
        apiConfigured,
        indexerConfigured,
      },
    });
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/services/wazuh-manager/arm — Restart scharfschalten (Passwort-Step-up).
// Verifiziert das Passwort des AKTUELLEN Users gegen dessen passwordHash. Bei
// Fehler → 403, ohne zu verraten, ob der User existiert (kein Enumeration-Leak).
// Erfolg → Flag true + Audit (NIE das Passwort in Metadaten).
router.post('/wazuh-manager/arm', requireAuth, requireRole('admin'), armLimiter, async (req, res, next) => {
  const actor = armActor(req);
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password === '') {
      return res.status(400).json({ error: 'password_required', message: 'Passwort erforderlich.', requestId: req.id });
    }

    // Aktuellen User laden + Passwort prüfen (fail-closed: fehlt Hash → invalide).
    const user = await authService._findById(req.user?.sub);
    const valid = user && user.passwordHash
      ? await authService.verifyPassword(password, user.passwordHash)
      : false;

    if (!valid) {
      // Kein Zustand geändert. Eigene Audit-Action für Fehlversuche (getrennt vom
      // Erfolg → sauberes SIEM-Alerting), ohne Passwort in den Metadaten.
      await auditService.write({
        ...actor,
        action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART_ARM_DENIED,
        targetType: 'wazuh_manager', targetId: 'manager',
        metadata: { outcome: 'denied_invalid_password' },
      }).catch((auditErr) => logger.error('wazuh_arm_audit_failed', { error: auditErr.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    const armed = await wazuhRestartArmStore.setArmed(true);

    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART_ARMED,
      targetType: 'wazuh_manager', targetId: 'manager',
      metadata: { outcome: 'armed' },
    });

    res.json({ data: { armed, armSource: wazuhRestartArmSource({ envEnabled: config.wazuh.managerRestartEnabled === true, dbArmed: armed }) }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/services/wazuh-manager/disarm — entschärfen (safe direction).
// Kein Passwort nötig: Entschärfen reduziert die Angriffsoberfläche.
router.post('/wazuh-manager/disarm', requireAuth, requireRole('admin'), async (req, res, next) => {
  const actor = armActor(req);
  try {
    const armed = await wazuhRestartArmStore.setArmed(false);

    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART_DISARMED,
      targetType: 'wazuh_manager', targetId: 'manager',
      metadata: { outcome: 'disarmed' },
    });

    res.json({ data: { armed, armSource: wazuhRestartArmSource({ envEnabled: config.wazuh.managerRestartEnabled === true, dbArmed: armed }) }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── Wazuh-Verbindung (Layer 2: Frontend-Administrierbarkeit) ──────────────────

const settingsRepo = createSettingsRepository();

// Eigener Limiter-INSTANZ, gleiche Politik wie armLimiter: auch hier steckt ein
// Online-Passwort-Step-up dahinter (bcrypt.compare) → Brute-Force-Schutz pro User.
const connLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// Nur Host[:Port] fürs Audit — keine Pfade/Query (defensiv, kein Credential-Leak).
function hostFromUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// true, wenn die Sektion eine nicht-leere URL hat, die NICHT intern ist (SSRF-Schutz).
function hasExternalUrl(section) {
  if (!section || typeof section !== 'object') return false;
  const url = typeof section.url === 'string' ? section.url.trim() : '';
  return url !== '' && !isInternalHttpUrl(url);
}

// GET /api/v1/services/wazuh-connection — maskierte Sicht (NIE Passwörter).
router.get('/wazuh-connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedWazuhConnection(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/services/wazuh-connection — speichern (admin + Passwort-Step-up).
// Semantik: Sektion fehlt = unverändert · URL leer = Sektion löschen (→ ENV-Fallback) ·
// Passwort leer = gespeichertes behalten. Danach werden die laufenden Clients
// sofort rekonfiguriert (kein Neustart).
router.put('/wazuh-connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = armActor(req);
  try {
    const body = req.body || {};

    const password = typeof body.password === 'string' ? body.password : '';
    if (password === '') {
      return res.status(400).json({ error: 'password_required', message: 'Passwort erforderlich.', requestId: req.id });
    }
    // Eingabe zuerst validieren (billig), dann erst der teure Step-up.
    if (hasExternalUrl(body.api) || hasExternalUrl(body.indexer)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'URL muss auf einen internen Host zeigen (localhost, RFC-1918).', requestId: req.id });
    }

    // Passwort-Step-up gegen den AKTUELLEN User (fail-closed, kein Enumeration-Leak).
    const user = await authService._findById(req.user?.sub);
    const valid = user && user.passwordHash
      ? await authService.verifyPassword(password, user.passwordHash)
      : false;
    if (!valid) {
      await auditService.write({
        ...actor,
        action: AUDIT_ACTIONS.WAZUH_CONNECTION_CHANGE_DENIED,
        targetType: 'wazuh_connection', targetId: 'wazuh',
        metadata: { outcome: 'denied_invalid_password' },
      }).catch((auditErr) => logger.error('wazuh_conn_audit_failed', { error: auditErr.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    const patch = {};
    if (body.api && typeof body.api === 'object') {
      patch.api = { url: body.api.url, user: body.api.user, password: body.api.password };
    }
    if (body.indexer && typeof body.indexer === 'object') {
      patch.indexer = { url: body.indexer.url, user: body.indexer.user, password: body.indexer.password };
    }

    try {
      await saveWazuhConnection(settingsRepo, patch);
    } catch (err) {
      // Unvollständige Sektion würde die laufende Verbindung brechen → ehrlicher 400.
      if (err.code === 'WAZUH_SECTION_INCOMPLETE') {
        return res.status(400).json({ error: 'SECTION_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }
    await applyWazuhConnection(settingsRepo);

    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_CONNECTION_CHANGED,
      targetType: 'wazuh_connection', targetId: 'wazuh',
      // NIE Credentials in den Metadaten — nur welche Sektionen angefasst wurden.
      metadata: { changed: Object.keys(patch) },
    });

    res.json({ data: await maskedWazuhConnection(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/services/wazuh-connection/test — Verbindungstest ohne Speichern.
// Leere Felder fallen auf die effektive Verbindung (DB > ENV) zurück, damit die UI
// auch das maskierte (nicht erneut eingetippte) Passwort mittesten kann.
//
// Defense-in-Depth (Security-Review): admin-only + interne Allowlist reichen als
// erste Schicht nicht — der Endpoint könnte sonst als SSRF-/Port-Scan-Orakel gegen
// das interne Netz dienen. Darum zusätzlich Rate-Limit + Audit (Ziel-Host + Ergebnis,
// NIE Credentials). Der Tester kappt zudem hart bei TEST_TIMEOUT_MS, damit die
// Antwortlatenz kein "offen/geschlossen"-Signal wird.
router.post('/wazuh-connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = armActor(req);
  try {
    const body = req.body || {};
    const target = String(body.target || '');
    if (!wazuhConnectionTester.TARGETS.includes(target)) {
      return res.status(400).json({ error: 'INVALID_TARGET', message: `Unbekanntes Ziel: ${target}`, requestId: req.id });
    }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (url !== '' && !isInternalHttpUrl(url)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'URL muss auf einen internen Host zeigen (localhost, RFC-1918).', requestId: req.id });
    }

    const conn = await resolveWazuhConnection(settingsRepo);
    const base = conn[target];
    const cfg = {
      url:      url !== '' ? url : base.url,
      user:     typeof body.user === 'string' && body.user.trim() !== '' ? body.user.trim() : base.user,
      password: typeof body.password === 'string' && body.password !== '' ? body.password : base.password,
    };

    const result = await wazuhConnectionTester.testConnection(target, cfg);

    // SOC-Nachvollziehbarkeit: jeder Test wird auditiert — nur Ziel-Host + Ergebnis,
    // niemals Benutzer/Passwort (kein Enumeration-/Scan-Blindflug).
    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_CONNECTION_TEST,
      targetType: 'wazuh_connection', targetId: target,
      metadata: { target, ok: result.ok, host: hostFromUrl(cfg.url) },
    }).catch((auditErr) => logger.error('wazuh_conn_test_audit_failed', { error: auditErr.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
