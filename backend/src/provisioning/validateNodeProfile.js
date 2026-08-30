'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_GITOPS_2 — Node-Profil-Validator (validate-only, rein)
//
// Prüft ein bereits geparstes Profil-Objekt (deploy/provisioning/nodes/*.yaml)
// auf Struktur + Sicherheits-Gates. **Führt nichts aus, ändert nichts, kein I/O,
// kein Netzwerk.** Gibt alle Fehler gesammelt zurück: { ok, errors }.
//
// Sicherheits-Leitsatz (P_GITOPS_1): der Installer ist bootstrap-only und ändert
// NIEMALS Netzwerk. Darum schlägt die Validierung bei gefährlichen Feldern fehl.
// ─────────────────────────────────────────────────────────────────────────

const KNOWN_ROLES = ['control_plane', 'normal_agent', 'integration_connector', 'network_sensor', 'gateway_sensor'];
const RISKY_FEATURES = ['sniffing', 'nat', 'routing'];
// Schlüsselnamen, die auf ein Secret im Klartext hindeuten (gehören nie ins Profil).
const SECRET_KEY = /(password|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer)/i;

function isObj(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

// Rekursiv nach Secret-verdächtigen Schlüsseln suchen (Tokens kommen aus dem Backend).
function scanSecrets(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((v, i) => scanSecrets(v, `${path}[${i}]`, errors)); return; }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (SECRET_KEY.test(k)) {
      errors.push(`Mögliches Secret im YAML verboten: '${p}' — Tokens/Passwörter kommen aus dem Backend, nicht aus Git`);
    }
    scanSecrets(v, p, errors);
  }
}

/**
 * Ein Node-Profil validieren (reines Objekt, kein Apply).
 * @param {object} profile  bereits geparstes YAML-Objekt
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateNodeProfile(profile) {
  const errors = [];
  if (!isObj(profile)) return { ok: false, errors: ['Profil ist kein Objekt (leeres/ungültiges YAML?)'] };

  // ── node ────────────────────────────────────────────────────────────────
  const node = profile.node;
  if (!isObj(node)) {
    errors.push('node fehlt oder ist kein Objekt');
  } else {
    if (!node.name || typeof node.name !== 'string') errors.push('node.name fehlt oder ist leer');
    if (!node.role) errors.push('node.role fehlt');
    else if (!KNOWN_ROLES.includes(node.role)) errors.push(`node.role unbekannt: '${node.role}' (erlaubt: ${KNOWN_ROLES.join(', ')})`);
  }
  const role = isObj(node) ? node.role : undefined;

  // ── install: Installer ändert niemals Netzwerk ───────────────────────────
  const install = profile.install;
  if (!isObj(install)) errors.push('install fehlt');
  else if (install.changeNetwork !== false) errors.push('install.changeNetwork muss false sein (Installer ändert niemals Netzwerk)');

  // ── network: kein Apply beim Install ─────────────────────────────────────
  const network = profile.network;
  if (isObj(network) && network.applyDuringInstall !== false) {
    errors.push('network.applyDuringInstall muss false sein (kein Netzwerk-Apply beim Install)');
  }

  // ── features ─────────────────────────────────────────────────────────────
  const features = isObj(profile.features) ? profile.features : {};
  // (1) riskante Features dürfen NIE applyDuringInstall=true haben.
  for (const f of RISKY_FEATURES) {
    if (isObj(features[f]) && features[f].applyDuringInstall === true) {
      errors.push(`features.${f}.applyDuringInstall=true verboten — ${f} Apply ist nie Teil des Installers`);
    }
  }
  // (2) Rollen-Restriktionen für 'requested'.
  const requested = (f) => isObj(features[f]) && features[f].requested === true;
  if (role === 'normal_agent') {
    for (const f of RISKY_FEATURES) if (requested(f)) errors.push(`normal_agent darf kein ${f} requested haben`);
  }
  if (requested('sniffing') && role !== 'network_sensor') errors.push(`sniffing requested nur für network_sensor erlaubt (role hier: ${role})`);
  if (requested('nat')      && role !== 'gateway_sensor') errors.push(`nat requested nur für gateway_sensor erlaubt (role hier: ${role})`);
  if (requested('routing')  && role !== 'gateway_sensor') errors.push(`routing requested nur für gateway_sensor erlaubt (role hier: ${role})`);

  // ── keine Secrets im YAML ────────────────────────────────────────────────
  scanSecrets(profile, '', errors);

  return { ok: errors.length === 0, errors };
}

module.exports = { validateNodeProfile, KNOWN_ROLES, RISKY_FEATURES };
