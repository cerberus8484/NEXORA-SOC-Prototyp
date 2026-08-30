'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Windows-Server Config-Media-Verpackung (Cloudbase-Init).
//
// Reine Funktion: verpackt das bereits gerenderte (secret-freie) Cloudbase-Init-
// User-Data-Skript in ein beschreibendes Media-Artefakt. Cloudbase-Init liest die
// User-Data von einem angehängten Config-Drive (OpenStack-Layout). Die konkrete
// Materialisierung des Volumes ist connector-spezifisch (attachConfigMedia) und der
// echte Zustellkanal (ISO/Config-Drive-Bau) folgt in Slice 6. KEINE IO-Seiteneffekte.
// ─────────────────────────────────────────────────────────────────────────

const GUEST_USERDATA_PATH = '/openstack/latest/user_data';
const DEFAULT_LABEL = 'config-2'; // Cloudbase-Init/config-drive-Standardlabel

/**
 * @param {object} p
 * @param {string} p.content     gerendertes User-Data-Skript (nicht leer)
 * @param {string} p.configHash  stabiler Hash der secret-freien Params (Idempotenz)
 * @param {string} [p.label]     Volume-Label (Default config-2)
 * @returns {{ filename: string, guestPath: string, content: string, configHash: string, label: string }}
 */
function buildWindowsServerConfigMedia({ content, configHash, label } = {}) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('buildWindowsServerConfigMedia: content (nicht leer) erforderlich');
  }
  if (typeof configHash !== 'string' || configHash.trim() === '') {
    throw new Error('buildWindowsServerConfigMedia: configHash erforderlich');
  }
  return {
    filename: `windows-userdata-${configHash.slice(0, 12)}.ps1`,
    guestPath: GUEST_USERDATA_PATH,
    content,
    configHash,
    label: label || DEFAULT_LABEL,
  };
}

module.exports = { buildWindowsServerConfigMedia, GUEST_USERDATA_PATH, DEFAULT_LABEL };
