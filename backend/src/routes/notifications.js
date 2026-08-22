'use strict';

// ── Notifications-Router (P-Notifications) ─────────────────────────────────
// Alle Endpoints sind user-scoped: req.user.sub isoliert jeden Zugriff.
// Kein Cross-User-Zugriff möglich — markRead prüft Ownership serverseitig.

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { notificationService } = require('../services/NotificationService');
const { deliverOutbound, buildTestNotification } = require('../services/notificationOutbound');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { saveNotificationSettings, maskedNotificationSettings } = require('../services/notificationSettings');
const { notificationConfigSchema } = require('../domain/validation/notificationConfigSchema');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const logger = require('../logger');

const router = Router();
const settingsRepo = createSettingsRepository();

// ── GET /api/v1/notifications/channels ───────────────────────────────────
// Konfigurationsstatus der Outbound-Kanäle — spiegelt jetzt DB > ENV.
// Sicherheits-Invariante: NUR Booleans — keine URLs/Secrets/Hosts nach außen.
// WICHTIG: Diese Route muss VOR '/' stehen (Prefix-Konflikt mit /:id).
router.get('/channels', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const masked = await maskedNotificationSettings(settingsRepo);
    const webhook = (id) => masked.channels.find((c) => c.id === id);
    res.json({
      outboundEnabled: Boolean(masked.outboundEnabled),
      channels: [
        { id: 'slack',   configured: Boolean(webhook('slack')?.urlSet) },
        { id: 'webhook', configured: Boolean(webhook('webhook')?.urlSet) },
        { id: 'teams',   configured: Boolean(webhook('teams')?.urlSet) },
        { id: 'email',   configured: Boolean(masked.email.host && masked.email.to) },
      ],
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/notifications/config — maskierte Editier-Sicht (admin) ────────
// Enthält Host/Port/From/To/User + *Set-Booleans + Quelle; NIE Passwort/URL.
router.get('/config', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedNotificationSettings(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/notifications/config — speichern (admin, verschlüsselt, + Audit) ─
// Secrets (SMTP-Passwort, Webhook-URLs) leer = unverändert. Leerer SMTP-Host löscht
// die Email-Sektion (→ ENV-Fallback). Wirkt sofort (deliverOutbound liest zur Sendezeit).
router.put('/config', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { error, value } = notificationConfigSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }
    const b = value;
    const patch = {};
    if (typeof b.outboundEnabled === 'boolean') patch.outboundEnabled = b.outboundEnabled;
    if (b.email && typeof b.email === 'object') {
      patch.email = {
        host: b.email.host, port: b.email.port, secure: b.email.secure,
        user: b.email.user, pass: b.email.pass, from: b.email.from, to: b.email.to,
      };
    }
    for (const field of ['slackWebhookUrl', 'genericWebhookUrl', 'teamsWebhookUrl']) {
      if (typeof b[field] === 'string') patch[field] = b[field];
    }

    await saveNotificationSettings(settingsRepo, patch);

    await auditService.write({
      actorUserId: req.user?.sub ?? null,
      actorLabel:  req.user?.email ?? 'unknown',
      action:      AUDIT_ACTIONS.NOTIFY_SETTINGS_CHANGED,
      targetType:  'platform_settings',
      targetId:    'notifications',
      // NIE Secrets loggen — nur welche Felder/Kanäle berührt wurden.
      metadata:    { fields: Object.keys(patch), emailSet: 'email' in patch },
      ip:          req.ip,
    });

    res.json({ data: await maskedNotificationSettings(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/notifications ─────────────────────────────────────────────
// Gibt Notifications des eingeloggten Users zurück.
// Query: ?unreadOnly=true  — nur ungelesene
//        ?limit=<n>        — max. n Einträge (Default: 50)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId    = req.user.sub;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit      = req.query.limit ? Math.min(Number(req.query.limit) || 50, 200) : 50;

    const result = await notificationService.listForUser(userId, { unreadOnly, limit });
    res.json({ ...result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/notifications/unread-count ────────────────────────────────
// Schnelles Badge-Polling — kein vollständiges Listing nötig.
// WICHTIG: Diese Route muss VOR /:id/read stehen (Prefix-Konflikt).
router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const count = await notificationService.unreadCount(req.user.sub);
    res.json({ data: { count }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications/test ──────────────────────────────────────
// Admin-Smoke-Test: schickt eine synthetische Test-Notification an die konfigurierten
// Outbound-Kanäle und meldet, welche angesprochen wurden. Antwort enthält NUR Kanal-IDs
// bzw. einen skip-Grund — niemals URLs/Creds (deliverOutbound kapselt das).
// WICHTIG: literaler Pfad — vor '/:id/read' mounten, damit 'test' nicht als :id greift.
router.post('/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await deliverOutbound(buildTestNotification());
    res.json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications/:id/read ──────────────────────────────────
// Markiert eine Notification als gelesen.
// Server prüft Ownership — kein Fremdzugriff möglich → 404 statt 403
// (kein Informationsleck ob die Notification existiert).
router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const updated = await notificationService.markRead(req.params.id, req.user.sub);
    if (!updated) {
      return res.status(404).json({ error: 'not_found', requestId: req.id });
    }
    res.json({ data: updated, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/notifications/read-all ──────────────────────────────────
// Markiert alle ungelesenen Notifications des Users als gelesen (Bulk-Aktion).
// WICHTIG: Muss VOR /:id/read stehen damit 'read-all' nicht als :id erkannt wird.
// Reihenfolge im Router: /unread-count → /read-all → /:id/read
router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    const result = await notificationService.markAllRead(req.user.sub);
    res.json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
