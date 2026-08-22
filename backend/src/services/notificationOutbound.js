'use strict';

/**
 * notificationOutbound.js — Optionaler Outbound-Versand
 * (Slack / generischer Webhook / Microsoft Teams / E-Mail per SMTP).
 *
 * Sicherheits-Invarianten (HART):
 *   - Kein Outbound ohne NOTIFICATIONS_OUTBOUND_ENABLED=true UND konfiguriertes Ziel.
 *   - URLs / SMTP-Creds niemals im Rückgabewert oder in Logs — nur anonyme Metadaten.
 *   - Best-effort: wirft NIEMALS, fängt alle Versand-Fehler intern.
 *   - Timeout: 5 Sekunden pro Versand-Versuch.
 *
 * Alle Funktionen sind injektions-testbar (httpPost-/sendMail-Dependency-Injection).
 */

const https = require('https');
const http  = require('http');
const logger = require('../logger');
const config = require('../config');

const OUTBOUND_TIMEOUT_MS = 5000;

// ── Payload-Builder (reine Funktionen, kein I/O) ─────────────────────────────

/**
 * Erzeugt den Slack-Nachrichten-Body für einen Outbound-Versand.
 * Kein Secret, keine URL — nur textueller Inhalt.
 *
 * @param {{ severity: string, title: string, body?: string, source?: string, createdAt?: string }} notification
 * @returns {{ text: string }}
 */
function buildSlackPayload(notification) {
  const { severity, title, body, source, createdAt } = notification;
  const parts = [
    `[${(severity || 'info').toUpperCase()}] ${title || ''}`,
  ];
  if (body)      parts.push(body);
  if (source)    parts.push(`Quelle: ${source}`);
  if (createdAt) parts.push(new Date(createdAt).toISOString());

  return { text: parts.join('\n') };
}

/**
 * Erzeugt den generischen Webhook-Body für einen Outbound-Versand.
 * Kein Secret, keine URL — nur strukturierte Felder.
 *
 * @param {{ severity: string, title: string, body?: string, source?: string, link?: string, createdAt?: string }} notification
 * @returns {object}
 */
function buildWebhookPayload(notification) {
  const { severity, title, body, source, link, createdAt } = notification;
  const payload = { severity, title, source, createdAt };
  if (body !== undefined) payload.body = body;
  if (link !== undefined) payload.link = link;
  return payload;
}

// Severity → Teams-MessageCard themeColor (hex ohne #).
const TEAMS_SEVERITY_COLOR = {
  critical: 'D32F2F', high: 'F57C00', medium: 'FBC02D', low: '388E3C', info: '1976D2',
};

/**
 * Erzeugt den Microsoft-Teams-Body (Legacy MessageCard) für einen Outbound-Versand.
 * Kein Secret, keine URL — nur textueller Inhalt + Fakten. Bewusst KEINE potentialAction:
 * Teams verlangt absolute URIs, unsere notification.link ist meist relativ.
 *
 * @param {{ severity: string, title: string, body?: string, source?: string, createdAt?: string }} notification
 * @returns {object} MessageCard
 */
function buildTeamsPayload(notification) {
  const { severity, title, body, source, createdAt } = notification;
  const sev = (severity || 'info').toUpperCase();
  const facts = [{ name: 'Schweregrad', value: sev }];
  if (source)    facts.push({ name: 'Quelle', value: source });
  if (createdAt) facts.push({ name: 'Zeit',   value: new Date(createdAt).toISOString() });

  return {
    '@type':    'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary:    title || 'Nexora SOC',
    themeColor: TEAMS_SEVERITY_COLOR[severity] || TEAMS_SEVERITY_COLOR.info,
    title:      `[${sev}] ${title || ''}`,
    sections:   [{ text: body || '', facts }],
  };
}

/**
 * Erzeugt den E-Mail-Body (Subject + Text) für einen Outbound-Versand.
 * Reine Funktion, kein I/O, keine SMTP-Daten — nur Inhalt der Notification.
 *
 * @param {{ severity: string, title: string, body?: string, source?: string, createdAt?: string }} notification
 * @returns {{ subject: string, text: string }}
 */
function buildEmailPayload(notification) {
  const { severity, title, body, source, createdAt } = notification;
  const sev = (severity || 'info').toUpperCase();

  const lines = [];
  if (body)      lines.push(body);
  if (source)    lines.push(`Quelle: ${source}`);
  if (createdAt) lines.push(`Zeit: ${new Date(createdAt).toISOString()}`);

  return {
    subject: `[${sev}] ${title || 'Nexora SOC'}`,
    text:    lines.join('\n'),
  };
}

/**
 * Erzeugt eine synthetische Test-Notification zur Kanal-Verifikation (Admin-Smoke-Test).
 * Reine Funktion, kein I/O — wird über deliverOutbound an die konfigurierten Kanäle geschickt.
 *
 * @returns {{ severity: string, title: string, body: string, source: string, createdAt: string }}
 */
function buildTestNotification() {
  return {
    severity:  'info',
    title:     'Nexora SOC — Test-Benachrichtigung',
    body:      'Dies ist eine Test-Benachrichtigung zur Überprüfung der Outbound-Kanäle. Kein echter Vorfall.',
    source:    'manual',
    createdAt: new Date().toISOString(),
  };
}

// ── Standard-HTTP-POST (produktiver Pfad, injizierbar für Tests) ─────────────

/**
 * Führt einen HTTP/HTTPS-POST mit JSON-Body und Timeout durch.
 * Wirft bei Netzwerkfehler oder Timeout (für best-effort-Wrapper oben).
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ status: number }>}
 */
function defaultHttpPost(url, body) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error(`Ungültige URL: ${typeof url}`));
    }

    const data    = JSON.stringify(body);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':     'Nexora-SOC-Notifier/1.0',
      },
    };

    const req = lib.request(options, (res) => {
      // Body lesen und verwerfen (kein Leak)
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });

    req.setTimeout(OUTBOUND_TIMEOUT_MS, () => {
      req.destroy(new Error('Outbound POST Timeout'));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Standard-SMTP-Versand (produktiver Pfad, injizierbar für Tests) ──────────

/**
 * Versendet eine E-Mail per SMTP. `nodemailer` wird LAZY geladen — das Modul
 * bleibt ohne konfigurierten E-Mail-Kanal komplett inert (kein Import-Aufwand).
 * Wirft bei SMTP-Fehler/Timeout (für den best-effort-Wrapper unten).
 *
 * @param {{ host: string, port: number, secure: boolean, user?: string, pass?: string, from?: string, to: string }} emailCfg
 * @param {{ subject: string, text: string }} payload
 * @returns {Promise<object>}
 */
function defaultSendMail(emailCfg, payload) {
  // eslint-disable-next-line global-require
  const nodemailer = require('nodemailer');

  const transport = nodemailer.createTransport({
    host:   emailCfg.host,
    port:   emailCfg.port,
    secure: emailCfg.secure,
    auth:   emailCfg.user ? { user: emailCfg.user, pass: emailCfg.pass } : undefined,
    connectionTimeout: OUTBOUND_TIMEOUT_MS,
    greetingTimeout:   OUTBOUND_TIMEOUT_MS,
    socketTimeout:     OUTBOUND_TIMEOUT_MS,
  });

  return transport.sendMail({
    from:    emailCfg.from || emailCfg.user,
    to:      emailCfg.to,        // nodemailer akzeptiert kommagetrennte Empfängerliste
    subject: payload.subject,
    text:    payload.text,
  });
}

// ── deliverOutbound ───────────────────────────────────────────────────────────

/**
 * Versendet eine Notification an konfigurierte externe Kanäle.
 *
 * Rückgabewerte (nie eine Exception):
 *   { skipped: 'disabled' }    — outboundEnabled=false (Default)
 *   { skipped: 'no_targets' }  — aktiviert, aber keine URL konfiguriert
 *   { sent: string[] }         — Liste der Kanal-IDs, die angesprochen wurden
 *
 * @param {object} notification
 * @param {{ httpPost?: Function, sendMail?: Function, config?: object }} opts — für Testbarkeit injizierbar
 * @returns {Promise<object>}
 */
async function deliverOutbound(notification, opts = {}) {
  const httpPost   = opts.httpPost   || defaultHttpPost;
  const sendMail   = opts.sendMail   || defaultSendMail;
  // Effektive Config: injiziert (Tests) ODER DB > ENV (Layer 2). Zur Sendezeit
  // aufgelöst → in der UI geänderte Kanäle wirken sofort, ohne Neustart.
  let cfg = opts.config;
  if (!cfg) {
    // eslint-disable-next-line global-require
    const { resolveNotificationConfig } = require('./notificationSettings');
    // eslint-disable-next-line global-require
    const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
    try {
      cfg = await resolveNotificationConfig(createSettingsRepository());
    } catch (err) {
      // Fail-safe: bei DB-Fehler weiter mit ENV — aber sichtbar machen (SOC-Tool:
      // ein stiller Settings-DB-Ausfall soll auffallen). Nur err.message, kein Secret.
      logger.warn('notification_config_resolve_failed', { error: err.message });
      cfg = config.notifications;
    }
  }

  // Sicherheits-Gate 1: ENV-Flag muss explizit true sein.
  if (!cfg.outboundEnabled) {
    return { skipped: 'disabled' };
  }

  // Ziele sammeln — jeder Kanal kapselt seinen Versand als Thunk, damit
  // Webhook-POST und SMTP-Versand denselben best-effort-Loop teilen.
  const targets = [];
  if (cfg.slackWebhookUrl)   targets.push({ id: 'slack',   send: () => httpPost(cfg.slackWebhookUrl,   buildSlackPayload(notification)) });
  if (cfg.genericWebhookUrl) targets.push({ id: 'webhook', send: () => httpPost(cfg.genericWebhookUrl, buildWebhookPayload(notification)) });
  if (cfg.teamsWebhookUrl)   targets.push({ id: 'teams',   send: () => httpPost(cfg.teamsWebhookUrl,   buildTeamsPayload(notification)) });
  if (cfg.email && cfg.email.host && cfg.email.to) {
    targets.push({ id: 'email', send: () => sendMail(cfg.email, buildEmailPayload(notification)) });
  }

  // Sicherheits-Gate 2: Keine Ziele konfiguriert.
  if (targets.length === 0) {
    return { skipped: 'no_targets' };
  }

  const sent = [];

  // Best-effort: jeder Versand läuft unabhängig, Fehler werden geloggt (ohne URL/Creds).
  for (const target of targets) {
    try {
      await target.send();
      sent.push(target.id);
    } catch (err) {
      // URL/SMTP-Daten NIEMALS loggen — nur Channel-ID und anonyme Fehlermeldung.
      logger.warn('notification_outbound_failed', {
        channel: target.id,
        error:   err.message,
      });
    }
  }

  // Rückgabe: nur Channel-IDs, KEINE URLs/Creds.
  return { sent };
}

module.exports = {
  buildSlackPayload,
  buildWebhookPayload,
  buildTeamsPayload,
  buildEmailPayload,
  buildTestNotification,
  deliverOutbound,
  defaultHttpPost,
  defaultSendMail,
};
