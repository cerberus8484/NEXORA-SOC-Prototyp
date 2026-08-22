'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — First-Boot-Drive deliver-Strategie.
//
// Erfüllt den deliver-Vertrag des OPNsense-Appliers:
//   deliver({ connector, vmid, xml, configHash, params, attempt }) → Promise
//
// Ablauf: gerenderte config.xml → Media-Artefakt verpacken (opnsenseConfigMedia)
// → über die Connector-Op `attachConfigMedia` an die laufende VM hängen. Der
// First-Boot-Importer im Golden-Template zieht die config.xml beim (Re)Boot.
//
// Fehler-Semantik (bewusst durchgereicht, damit Applier/Orchestrator greifen):
//   - Connector ohne attachConfigMedia → nicht-retrybarer Fehler (fail-safe,
//     KEIN stiller Erfolg) → Orchestrator rollt zurück.
//   - retryable-Fehler (Gast/Agent noch nicht bereit) bubbeln → Applier wiederholt.
//   - harter Fehler bubbelt → Rollback.
// ─────────────────────────────────────────────────────────────────────────

const { buildOpnsenseConfigMedia } = require('./opnsenseConfigMedia');

/**
 * @param {object} deps
 * @param {{ build: function }} deps.mediaBuilder  ({ xml, configHash, label }) → media
 */
function makeFirstBootDriveDeliver({ mediaBuilder } = {}) {
  if (!mediaBuilder || typeof mediaBuilder.build !== 'function') {
    throw new Error('makeFirstBootDriveDeliver: mediaBuilder erforderlich');
  }

  return async function firstBootDriveDeliver({ connector, vmid, xml, configHash, params } = {}) {
    if (!connector || typeof connector.attachConfigMedia !== 'function') {
      const e = new Error('First-Boot-Drive: Connector unterstützt attachConfigMedia nicht — kein Gast-Zustellkanal');
      e.retryable = false;
      throw e;
    }

    const label = `OPNSENSE_${String((params && params.hostname) || 'CFG')}`.toUpperCase().slice(0, 24);
    const media = mediaBuilder.build({ xml, configHash, label });
    const res = await connector.attachConfigMedia(vmid, media);

    return {
      applied: true,
      channel: 'first-boot-drive',
      configHash,
      mediaRef: (res && res.mediaRef) || media.filename,
    };
  };
}

module.exports = { makeFirstBootDriveDeliver };
