'use strict';

const { ImapFlow } = require('imapflow');
const logger = require('../../../logger');
const { createPollLoop } = require('../../pollLoop');

/**
 * IMAP-Poller — ruft ungelesene Mails ab und speist sie via
 * integrationService.ingest('email', ...) in dieselbe Pipeline ein wie der
 * E-Mail-Webhook (POST /api/v1/integrations/email/webhook → source='email' → Ticket).
 *
 * Erfolgreich verarbeitete Mails werden als \Seen markiert (Dedup-Backstop;
 * die externalId-Dedup im EmailProcessor greift zusätzlich).
 *
 * Fail-safe:
 *   - Fehlt eine Pflicht-ENV (IMAP_HOST/IMAP_USER/IMAP_PASSWORD) → Poller bleibt
 *     inaktiv, kein Crash, klare Log-Meldung.
 *   - Fehler pro Mail werden einzeln gefangen und geloggt (kein still verschluckter
 *     Fehler, kein Abbruch des ganzen Laufs); fehlerhafte Mails bleiben ungelesen.
 *
 * ENV:
 *   IMAP_HOST, IMAP_PORT (default 993), IMAP_USER, IMAP_PASSWORD,
 *   IMAP_TLS (default true; 'false' für STARTTLS/Klartext-Port).
 */

const POLL_INTERVAL_MS  = 60_000;
const POLL_TIMEOUT_MS   = 120_000;  // hängender Poll-Lauf wird hart begrenzt
const POLL_MAX_BACKOFF_MS = 300_000; // Backoff nach Fehlern, gedeckelt (5 min)
const MAILBOX          = 'INBOX';

function readConfig(env = process.env) {
  return {
    host:     env.IMAP_HOST || '',
    port:     Number(env.IMAP_PORT) || 993,
    user:     env.IMAP_USER || '',
    password: env.IMAP_PASSWORD || '',
    // TLS-Default an (impliziter TLS auf 993). Per IMAP_TLS=false abschaltbar.
    secure:   env.IMAP_TLS ? env.IMAP_TLS !== 'false' : true,
  };
}

/**
 * Prüft, ob der Poller laufen soll (alle Pflicht-ENV gesetzt).
 */
function isEnabled(env = process.env) {
  const c = readConfig(env);
  return Boolean(c.host && c.user && c.password);
}

class ImapPoller {
  /**
   * @param {object} integrationService — Ziel für ingest('email', ...)
   * @param {object} [opts]
   * @param {object}   [opts.env]          — ENV-Quelle (Tests)
   * @param {number}   [opts.intervalMs]
   * @param {Function} [opts.clientFactory] — (config) => ImapFlow-kompatibler Client (Tests)
   */
  constructor(integrationService, { env = process.env, settingsRepo = null, intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS, maxBackoffMs = POLL_MAX_BACKOFF_MS, clientFactory = null } = {}) {
    if (!integrationService) throw new Error('ImapPoller benötigt einen integrationService');
    this._svc          = integrationService;
    this._env          = env;
    this._settingsRepo = settingsRepo;   // Layer 2: DB > ENV. null → reines ENV (Tests).
    this._config       = readConfig(env);
    this._intervalMs   = intervalMs;
    this._timeoutMs    = timeoutMs;
    this._maxBackoffMs = maxBackoffMs;
    this._loop         = null;
    this._clientFactory = clientFactory || ((cfg) => new ImapFlow({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.user, pass: cfg.password },
      logger: false,
    }));
  }

  /** ENV-basierte Sofort-Einschätzung (Boot-Log-Hinweis) — NICHT mehr das Gate;
   *  die echte Vollständigkeit wird pro Poll-Zyklus aus DB > ENV aufgelöst. */
  isEnabled() {
    return isEnabled(this._env);
  }

  /** Effektive Verbindung pro Zyklus: DB (settingsRepo) > ENV. */
  async _resolveConfig() {
    if (!this._settingsRepo) {
      return { ...readConfig(this._env), source: this.isEnabled() ? 'env' : 'none' };
    }
    // eslint-disable-next-line global-require
    const { resolveImapConnection } = require('../../../services/imapConnectionSettings');
    return resolveImapConnection(this._settingsRepo, this._env);
  }

  /** true, wenn die effektive (DB>ENV) Verbindung vollständig ist. */
  async isConfigured() {
    const c = await this._resolveConfig();
    return Boolean(c.host && c.user && c.password);
  }

  /**
   * Startet den Poll-Loop IMMER (Layer 2: kein Boot-ENV-Gate mehr). Ist das Postfach
   * (noch) nicht konfiguriert, überspringt pollOnce jeden Lauf ohne Netzwerk — sobald
   * ein Admin es via UI setzt, greift der nächste Zyklus.
   * @returns {boolean}
   */
  start() {
    // Keine Credentials loggen — nur ENV-Konfiguriert-Hinweis + Intervall.
    logger.info('imap_poller_started', { configured: this.isEnabled(), intervalMs: this._intervalMs });

    // Überlappungssicherer Loop (Overlap-Guard + Timeout + Backoff + Status).
    this._loop = createPollLoop({
      name: 'imap',
      intervalMs:   this._intervalMs,
      timeoutMs:    this._timeoutMs,
      maxBackoffMs: this._maxBackoffMs,
      run:          () => this.pollOnce(),
      logger,
    });
    this._loop.start();
    return true;
  }

  stop() {
    if (this._loop) { this._loop.stop(); this._loop = null; }
  }

  /** Sichtbarer Lauf-Status (P_STABILITY_2 3.2): letzter Erfolg/Fehler, Overlaps, Timeouts. */
  status() {
    return this._loop ? this._loop.getStatus() : { name: 'imap', running: false };
  }

  /**
   * Ein Poll-Durchlauf: Verbindung (DB>ENV) auflösen, verbinden, ungelesene Mails
   * holen, je Mail in die Pipeline einspeisen und bei Erfolg als \Seen markieren.
   * Self-Skip: unkonfiguriert → kein Netzwerk, kein Fehler (wartet auf UI/ENV-Config).
   * @returns {Promise<{processed: number, failed: number, skipped?: boolean}>}
   */
  async pollOnce() {
    const cfg = await this._resolveConfig();
    if (!cfg.host || !cfg.user || !cfg.password) {
      return { processed: 0, failed: 0, skipped: true };
    }

    const client = this._clientFactory(cfg);
    let processed = 0;
    let failed    = 0;

    await client.connect();
    let lock;
    try {
      lock = await client.getMailboxLock(MAILBOX);
      const uids = await client.search({ seen: false }, { uid: true });

      for (const uid of (uids || [])) {
        try {
          const message = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!message) {
            failed += 1;
            logger.warn('imap_mail_fetch_empty', { uid });
            continue;
          }

          await this._svc.ingest('email', this._toPayload(message), { ip: 'imap' });
          // Erst nach erfolgreichem ingest als gelesen markieren (Dedup-Backstop).
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          processed += 1;
        } catch (err) {
          // Einzelne Mail fehlgeschlagen → loggen, ungelesen lassen, nächste Mail.
          failed += 1;
          logger.error('imap_mail_process_failed', { uid, message: err.message });
        }
      }
    } finally {
      if (lock) lock.release();
      await client.logout().catch((err) =>
        logger.warn('imap_logout_failed', { message: err.message }));
    }

    logger.info('imap_poll_done', { processed, failed });
    return { processed, failed };
  }

  /**
   * ImapFlow-Message → E-Mail-Payload für die Pipeline (gleiche Felder wie
   * der Webhook erwartet). Keine vollen Bodies ins Log.
   */
  _toPayload(message) {
    const env  = message.envelope || {};
    const from = Array.isArray(env.from) && env.from[0]
      ? `${env.from[0].address || ''}`.trim()
      : '';
    const to = Array.isArray(env.to) && env.to[0]
      ? `${env.to[0].address || ''}`.trim()
      : '';
    const text = message.source ? message.source.toString('utf8') : '';

    return {
      messageId:  env.messageId || '',
      from,
      to,
      subject:    env.subject || '',
      text,
      receivedAt: env.date ? new Date(env.date).toISOString() : new Date().toISOString(),
    };
  }
}

module.exports = { ImapPoller, isEnabled, readConfig, POLL_INTERVAL_MS };
