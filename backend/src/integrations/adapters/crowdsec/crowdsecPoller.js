'use strict';

const { CrowdsecLapiClient } = require('./CrowdsecLapiClient');
const { RealHttpClient }     = require('../../http/RealHttpClient');
const logger                 = require('../../../logger');
const { createPollLoop }     = require('../../pollLoop');

/**
 * CrowdsecPoller — zieht periodisch WAN-Alerts vom Webserver-CrowdSec (LAPI) und
 * speist jeden Alert via integrationService.ingest('crowdsec', ...) in dieselbe
 * Pipeline wie die Webhook-Quellen (Dedup → Normalize[CrowdsecAdapter] → Ticket).
 *
 * Fail-safe (wie imapPoller):
 *   - Fehlt eine Pflicht-ENV → Poller bleibt inaktiv, kein Crash, klares Log.
 *   - Fehler pro Alert werden einzeln gefangen (kein Abbruch des ganzen Laufs).
 *   - Credentials kommen NUR aus ENV (nie Repo), werden NIE geloggt.
 *
 * ENV:
 *   CROWDSEC_LAPI_URL, CROWDSEC_MACHINE_ID, CROWDSEC_PASSWORD
 *   CROWDSEC_TLS_INSECURE ('true' → self-signed LAPI-Zert akzeptieren)
 *   CROWDSEC_POLL_INTERVAL_MS (default 60000), CROWDSEC_SINCE (default '15m')
 */

const POLL_INTERVAL_MS    = 60_000;
const POLL_TIMEOUT_MS     = 120_000;  // hängender Poll-Lauf wird hart begrenzt
const POLL_MAX_BACKOFF_MS = 300_000;  // Backoff nach Fehlern, gedeckelt (5 min)
const DEFAULT_SINCE       = '15m';

function readConfig(env = process.env) {
  return {
    baseUrl:    env.CROWDSEC_LAPI_URL   || '',
    machineId:  env.CROWDSEC_MACHINE_ID || '',
    password:   env.CROWDSEC_PASSWORD   || '',
    tlsInsecure: env.CROWDSEC_TLS_INSECURE === 'true',
    intervalMs: Number(env.CROWDSEC_POLL_INTERVAL_MS) || POLL_INTERVAL_MS,
    since:      env.CROWDSEC_SINCE || DEFAULT_SINCE,
  };
}

function isEnabled(env = process.env) {
  const c = readConfig(env);
  return Boolean(c.baseUrl && c.machineId && c.password);
}

class CrowdsecPoller {
  /**
   * @param {object} integrationService — Ziel für ingest('crowdsec', ...)
   * @param {object} [opts]
   * @param {object}   [opts.env]
   * @param {number}   [opts.intervalMs]
   * @param {Function} [opts.clientFactory] — (config) => { fetchAlerts({since}) } (Tests)
   */
  constructor(integrationService, { env = process.env, settingsRepo = null, intervalMs, timeoutMs = POLL_TIMEOUT_MS, maxBackoffMs = POLL_MAX_BACKOFF_MS, clientFactory = null } = {}) {
    if (!integrationService) throw new Error('CrowdsecPoller benötigt einen integrationService');
    this._svc          = integrationService;
    this._env          = env;
    this._settingsRepo = settingsRepo;   // Layer 2: DB > ENV. null → reines ENV (Tests).
    this._config       = readConfig(env);
    this._intervalMs   = intervalMs || this._config.intervalMs;
    this._timeoutMs    = timeoutMs;
    this._maxBackoffMs = maxBackoffMs;
    this._loop         = null;
    this._clientFactory = clientFactory || ((cfg) => new CrowdsecLapiClient({
      baseUrl:    cfg.baseUrl,
      machineId:  cfg.machineId,
      password:   cfg.password,
      httpClient: new RealHttpClient({ rejectUnauthorized: !cfg.tlsInsecure }),
    }));
  }

  /** ENV-basierte Sofort-Einschätzung (Boot-Log-Hinweis) — NICHT mehr das Gate;
   *  die echte Vollständigkeit wird pro Poll-Zyklus aus DB > ENV aufgelöst. */
  isEnabled() {
    return isEnabled(this._env);
  }

  /** Effektive Verbindung pro Zyklus: DB (settingsRepo) > ENV. since/intervalMs aus ENV/Default. */
  async _resolveConfig() {
    const base = readConfig(this._env);
    if (!this._settingsRepo) return { ...base, source: this.isEnabled() ? 'env' : 'none' };
    // eslint-disable-next-line global-require
    const { resolveCrowdsecConnection } = require('../../../services/crowdsecConnectionSettings');
    const conn = await resolveCrowdsecConnection(this._settingsRepo, this._env);
    return { ...base, baseUrl: conn.baseUrl, machineId: conn.machineId, password: conn.password, tlsInsecure: conn.tlsInsecure, source: conn.source };
  }

  /**
   * Startet den Poll-Loop IMMER (Layer 2: keine Boot-ENV-Gate mehr). Ist die
   * Verbindung (noch) nicht konfiguriert, überspringt pollOnce jeden Lauf ohne
   * Netzwerk — sobald ein Admin sie via UI setzt, greift der nächste Zyklus.
   * @returns {boolean}
   */
  start() {
    logger.info('crowdsec_poller_started', { configured: this.isEnabled(), intervalMs: this._intervalMs });

    // Überlappungssicherer Loop (Overlap-Guard + Timeout + Backoff + Status).
    this._loop = createPollLoop({
      name: 'crowdsec',
      intervalMs:   this._intervalMs,
      timeoutMs:    this._timeoutMs,
      maxBackoffMs: this._maxBackoffMs,
      run:          () => this.pollOnce(),
      logger,
    });
    this._loop.start();
    return true;
  }

  /** true, wenn die effektive (DB>ENV) Verbindung vollständig ist. */
  async isConfigured() {
    const c = await this._resolveConfig();
    return Boolean(c.baseUrl && c.machineId && c.password);
  }

  stop() {
    if (this._loop) { this._loop.stop(); this._loop = null; }
  }

  /** Sichtbarer Lauf-Status (P_STABILITY_2 3.2): letzter Erfolg/Fehler, Overlaps, Timeouts. */
  status() {
    return this._loop ? this._loop.getStatus() : { name: 'crowdsec', running: false };
  }

  /**
   * Ein Poll-Durchlauf: Alerts seit `since` holen, je Alert in die Pipeline einspeisen.
   * Per-Alert-Fehler werden gefangen (kein Abbruch). Dedup macht die Pipeline.
   * @returns {Promise<{processed:number, failed:number}>}
   */
  async pollOnce() {
    const cfg = await this._resolveConfig();
    // Self-Skip: unkonfiguriert → kein Netzwerk, kein Fehler (wartet auf UI/ENV-Config).
    if (!cfg.baseUrl || !cfg.machineId || !cfg.password) {
      return { processed: 0, failed: 0, skipped: true };
    }

    const client = this._clientFactory(cfg);
    let processed = 0;
    let failed    = 0;

    const alerts = await client.fetchAlerts({ since: cfg.since });
    for (const alert of (alerts || [])) {
      try {
        await this._svc.ingest('crowdsec', alert, { ip: 'crowdsec-lapi' });
        processed += 1;
      } catch (err) {
        failed += 1;
        logger.error('crowdsec_alert_ingest_failed', { alertId: alert && alert.id, message: err.message });
      }
    }

    logger.info('crowdsec_poll_done', { processed, failed });
    return { processed, failed };
  }
}

module.exports = { CrowdsecPoller, isEnabled, readConfig, POLL_INTERVAL_MS };
