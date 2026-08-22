'use strict';

const { Router } = require('express');
const { verifyWebhookSignature }     = require('../integrations/hmac');
const { integrationService, KNOWN_SOURCES } = require('../integrations/IntegrationService');
const { NotFoundError, UnauthorizedError, ValidationError }  = require('../errors/AppError');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { buildEffectiveIntegrationStatus, INTEGRATION_IDS } = require('../integrations/integrationStatusMapper');
const { buildApiInfo }             = require('../integrations/apiInfoBuilder');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveWebhookSecret }     = require('../services/webhookSecretsSettings');
const { resolveWazuhConnection }   = require('../services/wazuhConnectionSettings');
const { resolveTiKey }             = require('../services/threatIntelKeys');
const { resolveOllamaConnection }  = require('../services/ollamaConnectionSettings');
const { probeOllamaConnection }    = require('../services/ollamaConnectionProbe');
const wazuhConnectionTester        = require('../services/wazuhConnectionTester');
const config                       = require('../config');
const logger = require('../logger');

const router = Router();
const settingsRepo = createSettingsRepository();

// Webhook-Secrets: Layer 2 — DB > ENV, je Quelle (Fallback auf `generic`). Wird pro
// Request aufgelöst, damit eine UI-Rotation SOFORT greift (kein Neustart).

/**
 * POST /api/v1/integrations/:source/webhook
 *
 * Verarbeitet eingehende Webhooks von externen Systemen.
 * HMAC-Signatur wird vor jeder Verarbeitung geprüft.
 *
 * Response:
 *   202 Accepted  — Event angenommen und normalisiert
 *   200 OK        — Duplikat erkannt, ignoriert
 *   400 Bad Request — Ungültiger Payload
 *   401 Unauthorized — Fehlende/ungültige Signatur
 *   404 Not Found — Unbekannte Quelle
 */
router.post('/:source/webhook', async (req, res, next) => {
  const source = req.params.source.toLowerCase();
  const ip     = req.ip || '';

  // 1. Bekannte Quelle prüfen — vor HMAC damit 404 vor 401 kommt
  if (!KNOWN_SOURCES.includes(source)) {
    return next(new NotFoundError(`Integrationsquelle '${source}'`));
  }

  // 2. HMAC-Secret vorhanden? (DB > ENV, je Quelle mit generic-Fallback)
  const secret = await resolveWebhookSecret(settingsRepo, source, process.env);
  if (!secret) {
    return next(new UnauthorizedError(`Kein Webhook-Secret für Quelle '${source}' konfiguriert`));
  }

  // 3. HMAC-Signatur verifizieren
  try {
    verifyWebhookSignature(req, secret);
  } catch (err) {
    return next(err);
  }

  // 4. Event verarbeiten
  try {
    const result = await integrationService.ingest(source, req.body, { ip });

    const httpStatus = result.status === 'duplicate' ? 200 : 202;
    res.status(httpStatus).json({
      status:     result.status,
      eventId:    result.eventId,
      requestId:  req.id,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/integrations/sources — verfügbare Quellen anzeigen
router.get('/sources', requireAuth, (req, res) => {
  res.json({ sources: KNOWN_SOURCES, requestId: req.id });
});

// ── GET /api/v1/integrations/status ──────────────────────────────────────────
//
// Liefert je Integration: id, name, category, configured, endpoint, status.
// Admin-only. Kein Netzwerk-Call — nur Config-Presence.
//
// SICHERHEIT: endpoint = nur Host (kein user:pass, kein Pfad, kein API-Key).
//             Response enthält KEINE Felder api_key/password/token/secret.

router.get('/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = await buildEffectiveIntegrationStatus({ settingsRepo, env: process.env });
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/integrations/api-info ────────────────────────────────────────
//
// Liefert API-Basis-Info für den Settings → "API / Webhooks"-Tab:
//   - rateLimit (max, windowMs, webhookMax) — aus config, read-only
//   - webhookReceivers — eingehende Ingest-Pfade je KNOWN_SOURCE + hmacConfigured (boolean)
//
// SICHERHEIT: hmacConfigured ist IMMER nur boolean — kein Secret-Wert.
//             Der tatsächliche HMAC-Key wird NIEMALS ausgeliefert.
//             Admin-only (requireRole).

router.get('/api-info', requireAuth, requireRole('admin'), (req, res) => {
  const info = buildApiInfo(process.env, config);
  res.json({ ...info, requestId: req.id });
});

// ── POST /api/v1/integrations/:id/test ───────────────────────────────────────
//
// Führt einen Live-Erreichbarkeitstest durch — NUR wo billig/sicher möglich.
//
// testbar: wazuh (managerStatus), ollama (/api/tags), virustotal/abuseipdb (isConfigured-Check)
// nicht testbar: qradar, splunk, servicenow, otrs, email → 501 + testable:false
//
// Response: { reachable: boolean, testedAt: string, message?: string }
// SICHERHEIT: kein Secret in Response/Log.

// Nicht-testbare Integrationen (kein einfacher Ping ohne volles API-Setup)
const NOT_TESTABLE = new Set(['qradar', 'splunk', 'servicenow', 'otrs', 'email']);

router.post('/:id/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  const id = req.params.id;

  // Allowlist — keine unbekannten IDs
  if (!INTEGRATION_IDS.includes(id)) {
    return next(new ValidationError(`Unbekannte Integration: '${id}'`));
  }

  // Nicht testbar → 501 ehrlich
  if (NOT_TESTABLE.has(id)) {
    return res.status(501).json({
      testable:  false,
      message:   `Integration '${id}' unterstützt keinen Live-Test (wird per ENV konfiguriert)`,
      requestId: req.id,
    });
  }

  const testedAt = new Date().toISOString();

  try {
    const result = await runLiveTest(id);
    res.json({ ...result, testedAt, requestId: req.id });
  } catch (err) {
    // Erreichbarkeits-Fehler sind erwartet wenn nicht konfiguriert — kein 5xx
    logger.warn('integration_test_failed', { id, message: err.message });
    res.json({ reachable: false, testedAt, message: 'Verbindung fehlgeschlagen', requestId: req.id });
  }
});

/**
 * Live-Test je Integration.
 * Nur öffentlich-sichere Endpunkte — kein Secret in Ergebnis.
 *
 * @param {string} id
 * @returns {Promise<{ reachable: boolean, message?: string }>}
 */
async function runLiveTest(id) {
  if (id === 'wazuh') {
    const conn = await resolveWazuhConnection(settingsRepo);
    if (!(conn.api.url && conn.api.user && conn.api.password)) {
      return { reachable: false, message: 'Wazuh-API nicht konfiguriert' };
    }
    const probe = await wazuhConnectionTester.testConnection('api', conn.api);
    return { reachable: probe.ok === true, message: probe.ok ? 'Manager erreichbar' : (probe.error || 'Keine Antwort') };
  }

  if (id === 'ollama') {
    const { baseUrl, model } = await resolveOllamaConnection(settingsRepo, process.env);
    const probe = await probeOllamaConnection({ baseUrl, model, requireModel: true, timeout: 5000 });
    return {
      reachable: probe.reachable,
      modelAvailable: probe.modelAvailable,
      reason: probe.reason,
      message: probe.message,
    };
  }

  if (id === 'virustotal') {
    // VirusTotal: kein billiger Ping ohne ein echtes Query — nur Config-Check
    const configured = Boolean((await resolveTiKey('virustotal', settingsRepo)).key);
    return {
      reachable: configured,
      message:   configured ? 'API-Key konfiguriert (kein Live-Ping — Quota-Schutz)' : 'VIRUSTOTAL_API_KEY fehlt',
    };
  }

  if (id === 'abuseipdb') {
    const configured = Boolean((await resolveTiKey('abuseipdb', settingsRepo)).key);
    return {
      reachable: configured,
      message:   configured ? 'API-Key konfiguriert (kein Live-Ping — Quota-Schutz)' : 'ABUSEIPDB_API_KEY fehlt',
    };
  }

  // Fallback (sollte nie erreicht werden durch Allowlist)
  return { reachable: false, message: 'Kein Test für diese Integration implementiert' };
}

module.exports = router;
