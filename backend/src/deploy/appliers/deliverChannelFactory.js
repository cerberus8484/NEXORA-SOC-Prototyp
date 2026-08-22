'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Auswahl des config-deliver-Kanals (DEPLOY_DELIVER_CHANNEL).
//
// Der OPNsense-Applier bekommt seinen `deliver` von hier. Default (unset / 'none'
// / unbekannt) → fail-safe: der deliver WIRFT (nicht-retrybar), damit ein Deploy
// nie eine unkonfigurierte VM als „deployed" meldet, sondern kontrolliert zurück-
// rollt. Nur ein explizit gesetzter Kanal + vorhandener mediaBuilder liefert eine
// echte Zustellung. Das spiegelt den Kill-Switch-Stil des restlichen Deploy-Pfads.
//
// Aktuell bekannter Kanal: 'first-boot-drive' (config.xml als Volume anhängen,
// Golden-Template-Importer zieht sie beim Boot).
// ─────────────────────────────────────────────────────────────────────────

const { makeFirstBootDriveDeliver } = require('./firstBootDriveDeliver');

// Fail-safe deliver: wirft nicht-retrybar mit klarem Grund (kein stiller Erfolg).
function makeFailSafeDeliver(reason) {
  return async function failSafeDeliver() {
    const e = new Error(`OPNsense-Config-Delivery nicht konfiguriert — ${reason}`);
    e.retryable = false;
    throw e;
  };
}

/**
 * @param {object} p
 * @param {string} [p.channel]      Kanal-Kennung (z. B. 'first-boot-drive')
 * @param {{ build: function }} [p.mediaBuilder]
 * @returns {function} deliver
 */
function makeDeliverChannel({ channel, mediaBuilder } = {}) {
  switch (String(channel || '').trim().toLowerCase()) {
    case 'first-boot-drive':
      if (!mediaBuilder) {
        return makeFailSafeDeliver('DEPLOY_DELIVER_CHANNEL=first-boot-drive, aber kein mediaBuilder konfiguriert');
      }
      return makeFirstBootDriveDeliver({ mediaBuilder });
    case '':
    case 'none':
      return makeFailSafeDeliver('kein Gast-Zustellkanal gesetzt (DEPLOY_DELIVER_CHANNEL)');
    default:
      return makeFailSafeDeliver(`unbekannter DEPLOY_DELIVER_CHANNEL '${channel}'`);
  }
}

/** Liest den Kanal aus der Umgebung (DEPLOY_DELIVER_CHANNEL). */
function resolveDeliverFromEnv({ mediaBuilder } = {}) {
  return makeDeliverChannel({ channel: process.env.DEPLOY_DELIVER_CHANNEL, mediaBuilder });
}

module.exports = { makeDeliverChannel, resolveDeliverFromEnv, makeFailSafeDeliver };
