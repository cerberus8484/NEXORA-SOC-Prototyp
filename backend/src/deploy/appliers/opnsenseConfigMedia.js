'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Config-Media-Verpackung (First-Boot-Drive).
//
// Reine Funktion: verpackt die bereits gerenderte (XML-escapte) config.xml in
// ein beschreibendes Media-Artefakt. OPNsense importiert beim ersten Boot eine
// config.xml, die es unter /conf/config.xml auf einem angehängten Volume findet
// (Golden-Template-First-Boot-Importer) — genau diesen Pfad benennen wir hier.
//
// KEINE Hypervisor-/IO-Seiteneffekte: die Materialisierung des Volumes ist
// connector-spezifisch (attachConfigMedia). Diese Schicht ist deterministisch
// und secret-frei (der Renderer liefert nur Netzwerk-Felder).
// ─────────────────────────────────────────────────────────────────────────

const GUEST_IMPORT_PATH = '/conf/config.xml';
const DEFAULT_LABEL = 'OPNSENSE_CFG';

/**
 * @param {object} p
 * @param {string} p.xml         gerenderte config.xml (nicht leer)
 * @param {string} p.configHash  stabiler Hash der secret-freien Params (Idempotenz)
 * @param {string} [p.label]     Volume-Label (Default OPNSENSE_CFG)
 * @returns {{ filename: string, guestPath: string, content: string, configHash: string, label: string }}
 */
function buildOpnsenseConfigMedia({ xml, configHash, label } = {}) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('buildOpnsenseConfigMedia: xml (nicht leer) erforderlich');
  }
  if (typeof configHash !== 'string' || configHash.trim() === '') {
    throw new Error('buildOpnsenseConfigMedia: configHash erforderlich');
  }
  return {
    filename: `opnsense-config-${configHash.slice(0, 12)}.xml`,
    guestPath: GUEST_IMPORT_PATH,
    content: xml,
    configHash,
    label: label || DEFAULT_LABEL,
  };
}

module.exports = { buildOpnsenseConfigMedia, GUEST_IMPORT_PATH, DEFAULT_LABEL };
