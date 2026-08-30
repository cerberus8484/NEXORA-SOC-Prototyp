'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Control-Adapter `ssh-firewall-collector` — installiert den Nexora-Firewall-
// Collector auf einem bestehenden Linux-Host (Brownfield).
//
// Auth-agnostisch wie die Wazuh-Adapter: der SSH-Transport wird als `runner`
// INJIZIERT, dieser Adapter kennt weder Key noch Secret (leak-frei by design).
//
// Verteilung: der Collector liegt im privaten Data-Plane-Repo und wird als
// Release-Artefakt ausgeliefert. Der Aufrufer gibt Version UND SHA256 an; der
// Installer prüft die Prüfsumme, BEVOR das Binary ausgeführt wird. Damit gilt
// derselbe Maßstab wie beim Wazuh-Installer (GPG-/Authenticode-Pinning):
// niemals ungeprüften Code ausführen. Die Prüfsumme ist deshalb PFLICHT.
//
// Alle Werte gehen als validierte ENV an den Runner — nie in eine Befehlszeile.
// ─────────────────────────────────────────────────────────────────────────

const HOST_RE    = /^[a-zA-Z0-9.-]{1,253}$/;
const USER_RE    = /^[a-z_][a-z0-9_-]{0,31}$/;
const VERSION_RE = /^v?[0-9]+(\.[0-9]+){0,3}(-[a-zA-Z0-9.]{1,20})?$/;  // v1.2.0 / 1.2.0-rc1
const SHA256_RE  = /^[a-f0-9]{64}$/i;
// Intake-URL: nur http(s), keine Leerzeichen/Steuerzeichen, moderate Länge.
const URL_RE     = /^https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,500}$/;
// Collector-Token: bewusst enger Zeichensatz — es geht als ENV-Wert an den Runner,
// dessen Preamble nur diese Zeichen zulässt. Ein Token mit Anführungszeichen oder
// Shell-Metazeichen wird hier abgelehnt (klare Meldung) statt später im Transport.
const TOKEN_RE   = /^[A-Za-z0-9_.:/@-]{8,255}$/;

const DEFAULT_TIMEOUT_MS = 180000; // 3 min — Download + Install

class DeployAdapterError extends Error {
  constructor(message) { super(message); this.name = 'DeployAdapterError'; }
}

/** Strikte Validierung + Normalisierung (fail-fast, VOR jedem Runner-Aufruf). */
function validateParams(p = {}) {
  const targetHost       = String(p.targetHost ?? '');
  const sshUser          = String(p.sshUser ?? 'root');
  const sshPort          = p.sshPort ?? 22;
  const collectorVersion = String(p.collectorVersion ?? '');
  const checksumSha256   = String(p.checksumSha256 ?? '');
  const intakeUrl        = String(p.intakeUrl ?? '');
  // Bezugsquelle des Artefakts — optional. Ein Deploy darf NICHT daran hängen, dass
  // jemand ein GitHub-Release hochlädt: interner Webserver, Spiegel oder Air-Gap-Share
  // sind gleichwertig. Die Integrität hängt an der Prüfsumme, nicht an der Herkunft.
  const artifactBaseUrl  = p.artifactBaseUrl != null && p.artifactBaseUrl !== '' ? String(p.artifactBaseUrl) : undefined;

  if (!HOST_RE.test(targetHost))          throw new DeployAdapterError('ungültiger targetHost');
  if (!USER_RE.test(sshUser))             throw new DeployAdapterError('ungültiger sshUser');
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new DeployAdapterError('ungültiger sshPort');
  if (!VERSION_RE.test(collectorVersion)) throw new DeployAdapterError('ungültige collectorVersion');
  // Ohne Prüfsumme wird NICHT installiert — sie ist der Integritätsanker des Release-Artefakts.
  if (!SHA256_RE.test(checksumSha256))    throw new DeployAdapterError('ungültige oder fehlende checksumSha256 (64 Hex-Zeichen)');
  if (!URL_RE.test(intakeUrl))            throw new DeployAdapterError('ungültige intakeUrl (nur http/https)');
  if (artifactBaseUrl !== undefined && !URL_RE.test(artifactBaseUrl)) {
    throw new DeployAdapterError('ungültige artifactBaseUrl (nur http/https)');
  }

  return { targetHost, sshUser, sshPort, collectorVersion, checksumSha256, intakeUrl, artifactBaseUrl };
}

/**
 * Installiert den Firewall-Collector auf dem Ziel-Host (idempotent — der Installer
 * lässt eine bereits laufende, versionsgleiche Installation unangetastet).
 * Liefert ein strukturiertes, redigiertes Ergebnis (nie rohe Fehler/Secrets).
 *
 * @param {object} params  { targetHost, sshUser?, sshPort?, collectorVersion, checksumSha256, intakeUrl }
 * @param {object} deps    { runner } — SSH-Transport (injiziert)
 * @returns {Promise<{ok:boolean, host?:string, version?:string, reason?:string}>}
 */
async function runCollectorInstall(scriptId, params = {}, { runner, collectorToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof runner !== 'function') {
    // Fail-closed: ohne Transport wird NICHT so getan, als sei etwas passiert.
    throw new DeployAdapterError('runner (SSH-Transport) erforderlich');
  }
  const v = validateParams(params);

  const env = {
    COLLECTOR_VERSION:  v.collectorVersion,
    COLLECTOR_SHA256:   v.checksumSha256,
    NEXORA_INTAKE_URL:  v.intakeUrl,
  };
  // Nur setzen, wenn angegeben — sonst bleibt der Installer-Default (Release im
  // Control-Plane-Repo) wirksam; ein leeres ENV würde ihn überschreiben.
  if (v.artifactBaseUrl) env.RELEASE_BASE = v.artifactBaseUrl;

  // Credential: wird zur Apply-Zeit INJIZIERT (wie der Runner), NICHT aus den Params
  // gelesen — Secrets gehören nicht in eine DeploySpec (assertNoSecrets lehnt sie ab)
  // und würden sonst in Plan/Audit/Historie stehen. Bewusst optional: ohne Token
  // installiert der Collector trotzdem, sendet aber (noch) nicht authentifiziert.
  if (collectorToken !== undefined && collectorToken !== null && collectorToken !== '') {
    const t = String(collectorToken);
    if (!TOKEN_RE.test(t)) throw new DeployAdapterError('ungültiges collectorToken');
    env.NEXORA_COLLECTOR_TOKEN = t;
  }

  const res = await runner({
    host: v.targetHost, user: v.sshUser, port: v.sshPort,
    env, scriptId, timeoutMs,
  });

  if (res && res.timedOut) {
    return { ok: false, host: v.targetHost, reason: 'timeout: Installation hat die Zeitgrenze überschritten' };
  }
  if (!res || res.code !== 0) {
    // Rohen stderr/stdout NICHT nach außen geben (kann Pfade/Tokens des Ziels enthalten);
    // der Runner loggt ihn server-seitig.
    return { ok: false, host: v.targetHost, reason: `Installer beendet mit Code ${res ? res.code : 'unbekannt'}` };
  }
  return { ok: true, host: v.targetHost, version: v.collectorVersion };
}

/**
 * Fabrik für Kollektor-Installer. Alle Nexora-Kollektoren haben dieselbe Form
 * (Binary per Release-Artefakt, SHA256-Pflicht, Ziel = Intake) und unterscheiden
 * sich nur im Skript. Ein neuer Kollektor ist damit ein Einzeiler plus Installer —
 * kein zweiter Adapter, der mit der Zeit auseinanderdriftet.
 *
 * @param {{scriptId: string}} opts  Allowlist-Key des Installer-Skripts
 * @returns {(params: object, deps: object) => Promise<object>}
 */
function makeCollectorInstaller({ scriptId } = {}) {
  if (typeof scriptId !== 'string' || scriptId === '') {
    throw new DeployAdapterError('makeCollectorInstaller: scriptId erforderlich');
  }
  return (params, deps) => runCollectorInstall(scriptId, params, deps);
}

// Die konkreten Kollektoren. Der scriptId MUSS in der Allowlist des Runners stehen
// (sshExecRunner: SCRIPT_ALLOWLIST + SCRIPT_SHELL) — sonst lehnt der Transport ab.
const installFirewallCollector = makeCollectorInstaller({ scriptId: 'install-firewall-collector' });
const installSiemCollector     = makeCollectorInstaller({ scriptId: 'install-siem-collector' });

module.exports = {
  makeCollectorInstaller,
  installFirewallCollector,
  installSiemCollector,
  DeployAdapterError,
};
