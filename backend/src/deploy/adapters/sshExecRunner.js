'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Echter SSH-Runner — Transport für den `ssh-systemd`-Control-Adapter.
// Erfüllt den Runner-Vertrag des Adapters:
//   runner({ host, user, port, env, scriptId, timeoutMs })
//     → Promise<{ code, timedOut }>
//
// SICHERHEIT (das ist die RCE-Fläche der Plattform — bewusst hart abgesichert):
//   1. Host-Policy (SSRF, OWASP A10): Link-local/Metadata (169.254.x / IMDS) IMMER
//      abgelehnt; mit Allowlist nur gelistete Hosts; ohne Allowlist keine public IPs.
//   2. scriptId ist ein ALLOWLIST-Key → fester Installer-Pfad. Niemals ein Pfad/eine
//      Command-Zeile aus Nutzereingabe. Unbekannt ⇒ fail-closed (wirft).
//   3. Host-Key-Pinning: der erwartete Server-Key (SHA-256) kommt aus dem Connector.
//      KEIN gepinnter Key ⇒ Verbindung abgelehnt (kein blindes TOFU). Timing-safe.
//   4. Der Private-Key wird als In-Memory-Wert an ssh2 übergeben — NIE auf Platte
//      geschrieben (kein Temp-Keyfile-Leak). Der Runner kennt nur den injizierten Key.
//   5. ENV geht als validierte `export`-Preamble über stdin an `bash -s` — der Installer
//      liest WAZUH_MANAGER/-AGENT_NAME/-AGENT_VERSION aus der Umgebung. Keine Interpolation
//      von Nutzereingabe in eine Shell-Command-Zeile. Metazeichen/Quotes/Newline abgelehnt.
//   6. fail-closed + Timeout; rohe Transport-Fehler NUR ins Log, nie in Return/Fehlertext.
//
// Hinweis: `client.exec(...)` unten ist die ssh2-NETZWERK-API (führt ein Kommando auf
// dem Ziel-Host aus), NICHT Nodes child_process.exec — es gibt keinen lokalen Shell-Spawn.
// Das ausgeführte Kommando ist die Konstante `bash -s`; Nutzereingaben landen nur als
// validierte ENV über stdin, nie in der Command-Zeile.
//
// Der reale ssh2-Client wird lazy geladen (defaultCreateClient) und ist injizierbar,
// damit die risikoreiche Stream-Orchestrierung ohne echten Server testbar bleibt.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const logger = require('../../logger');
const { isPublicIp } = require('../../integrations/threatIntel/ipClass');

const DEFAULT_TIMEOUT_MS = 300000;      // 5 min — apt/msiexec-Install kann dauern
const CONNECT_TIMEOUT_CAP_MS = 30000;   // Handshake-Deckel (unabhängig vom Gesamt-Timeout)

// ENV-Härtung (Defense-in-Depth): Key = POSIX-ENV-Name (Großbuchstaben), Wert ohne
// jegliche Shell-Metazeichen/Quotes/Whitespace → single-quoten ist in BEIDEN Ziel-Shells
// sicher: bash `export K='v'` und PowerShell `$env:K='v'` sind bei diesem Zeichensatz
// literal (kein `'`, kein Backtick, kein `$(...)`, kein Newline).
// ACHTUNG: Diese eine Regex trägt die Sicherheit ZWEIER Shell-Grammatiken. Bei JEDER
// Erweiterung des Zeichensatzes bash UND PowerShell erneut prüfen (Tests decken beide ab).
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_VAL_RE = /^[A-Za-z0-9_.:/@-]{0,255}$/;
const HOSTKEY_HEX_RE = /^[a-f0-9]{64}$/i;   // gepinnter Host-Key = SHA-256 als Hex
const STDERR_LOG_CAP = 2000;                // nur so viel Installer-stderr fürs Log behalten

// Cloud-Metadata + Link-local immer verweigern (auch wenn allowlisted).
const METADATA_HOSTS = new Set(['100.100.100.200']);
function isBlockedHost(host) { return /^169\.254\./.test(String(host)) || METADATA_HOSTS.has(String(host)); }

// scriptId → FESTER Installer-Pfad (Allowlist). Nie aus Nutzereingabe abgeleitet.
// backend/src/deploy/adapters → Repo-Root ist 4 Ebenen höher.
const SCRIPT_ALLOWLIST = Object.freeze({
  'install-wazuh-agent':         path.resolve(__dirname, '../../../../deploy/install-wazuh-agent.sh'),
  'install-wazuh-agent-windows': path.resolve(__dirname, '../../../../deploy/install-wazuh-agent.ps1'),
  'update-wazuh-agent-windows':  path.resolve(__dirname, '../../../../deploy/update-wazuh-agent-windows.ps1'),
  'update-wazuh-agent':          path.resolve(__dirname, '../../../../deploy/update-wazuh-agent.sh'),
  // ADR-042 Slice 3a — umkehrbares Linux-Containment (nftables), Mgmt-Kanal bleibt offen.
  // Phase 3 — Nexora-Firewall-Collector (Release-Artefakt + SHA256-Pruefung im Installer).
  'install-firewall-collector':  path.resolve(__dirname, '../../../../deploy/install-firewall-collector.sh'),
  'install-siem-collector':      path.resolve(__dirname, '../../../../deploy/install-siem-collector.sh'),
  'install-ids-sensor':          path.resolve(__dirname, '../../../../deploy/install-ids-sensor.sh'),
  'isolate-host':                path.resolve(__dirname, '../../../../deploy/isolate-host.sh'),
  'release-isolation':           path.resolve(__dirname, '../../../../deploy/release-isolation.sh'),
  // ADR-042 Slice 3c — umkehrbares Windows-Containment (Windows-Firewall), Mgmt-Kanal bleibt offen.
  'isolate-host-windows':        path.resolve(__dirname, '../../../../deploy/isolate-host.ps1'),
  'release-isolation-windows':   path.resolve(__dirname, '../../../../deploy/release-isolation.ps1'),
});

// Pro scriptId: Remote-Shell + ENV-Preamble-Stil (OS-abhängig). FEST verdrahtet, nie
// aus Nutzereingabe — Linux nutzt `bash -s` + `export`, Windows OpenSSH `powershell … -Command -`
// + `$env:`. Der Wert selbst ist durch ENV_VAL_RE ohnehin quote-/metazeichenfrei.
const SCRIPT_SHELL = Object.freeze({
  'install-wazuh-agent':         { shell: 'bash -s', envStyle: 'bash' },
  'install-wazuh-agent-windows': { shell: 'powershell -NoProfile -NonInteractive -Command -', envStyle: 'powershell' },
  'update-wazuh-agent-windows':  { shell: 'powershell -NoProfile -NonInteractive -Command -', envStyle: 'powershell' },
  'update-wazuh-agent':          { shell: 'bash -s', envStyle: 'bash' },
  'install-firewall-collector':  { shell: 'bash -s', envStyle: 'bash' },
  'install-siem-collector':      { shell: 'bash -s', envStyle: 'bash' },
  'install-ids-sensor':          { shell: 'bash -s', envStyle: 'bash' },
  'isolate-host':                { shell: 'bash -s', envStyle: 'bash' },
  'release-isolation':           { shell: 'bash -s', envStyle: 'bash' },
  'isolate-host-windows':        { shell: 'powershell -NoProfile -NonInteractive -Command -', envStyle: 'powershell' },
  'release-isolation-windows':   { shell: 'powershell -NoProfile -NonInteractive -Command -', envStyle: 'powershell' },
});

class SshRunnerError extends Error {
  constructor(message) { super(message); this.name = 'SshRunnerError'; }
}

/** SSRF-Host-Policy (identisch zur Connector-Härtung). Wirft bei Verstoß. */
function assertHostAllowed(host, allowedHosts = []) {
  const h = String(host || '');
  if (!h) throw new SshRunnerError('Ziel-Host fehlt');
  if (isBlockedHost(h)) throw new SshRunnerError('Ziel-Host abgelehnt (Link-local/Metadata)');
  const allowed = (allowedHosts || []).map(String);
  if (allowed.length > 0) {
    if (!allowed.includes(h)) throw new SshRunnerError('Ziel-Host nicht in der Deploy-Allowlist');
  } else if (isPublicIp(h)) {
    throw new SshRunnerError('öffentlicher Ziel-Host ohne Allowlist abgelehnt');
  }
}

/** Baut die sichere ENV-Preamble aus validierter ENV (wirft bei Injektion).
 *  style='bash' → `export K='v'` · style='powershell' → `$env:K='v'`. Werte sind durch
 *  ENV_VAL_RE quote-/metazeichenfrei, daher ist single-quoten in beiden Shells sicher. */
function buildEnvPreamble(env = {}, style = 'bash') {
  const lines = [];
  for (const [key, rawVal] of Object.entries(env || {})) {
    const val = String(rawVal);
    if (!ENV_KEY_RE.test(key)) throw new SshRunnerError('ungültiger ENV-Key');
    if (!ENV_VAL_RE.test(val)) throw new SshRunnerError('ungültiger ENV-Wert (Metazeichen/Quote/Newline)');
    lines.push(style === 'powershell' ? `$env:${key}='${val}'` : `export ${key}='${val}'`);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Liest den Installer über die scriptId-Allowlist (fail-closed bei unbekannt/leer). */
function defaultScriptSource(scriptId) {
  const key = String(scriptId);
  // Expliziter Allowlist-Check: Prototype-Keys (__proto__/constructor/…) laufen so über
  // den korrekt beschrifteten Ablehnungs-Pfad, nicht zufällig über einen try/catch.
  if (!Object.prototype.hasOwnProperty.call(SCRIPT_ALLOWLIST, key)) {
    throw new SshRunnerError('unbekannte scriptId — abgelehnt (Allowlist)');
  }
  const scriptPath = SCRIPT_ALLOWLIST[key];
  let content;
  try { content = fs.readFileSync(scriptPath, 'utf8'); }
  catch { throw new SshRunnerError('Installer-Skript nicht gefunden'); }
  if (!content) throw new SshRunnerError('Installer-Skript leer');
  return content;
}

function defaultCreateClient() {
  // Lazy — nur im realen Pfad; Unit-Tests injizieren einen Fake.
  const { Client } = require('ssh2');
  return new Client();
}

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Erzeugt einen SSH-Runner. Key + gepinnte Host-Keys werden INJIZIERT (aus dem
 * verschlüsselten Connector) — der Runner enthält selbst kein Secret.
 *
 * @param {object}   opts
 * @param {string|Buffer} opts.privateKey  In-Memory-Private-Key (nie Dateipfad).
 * @param {string}   [opts.passphrase]     optionale Key-Passphrase.
 * @param {Record<string,string>} opts.hostKeys  host → erwarteter SHA-256(Server-Key) hex.
 * @param {string[]} [opts.allowedHosts]   Deploy-Allowlist der Ziel-Hosts.
 * @param {Function} [opts.createClient]   Factory → ssh2-Client (Test-Injektion).
 * @param {Function} [opts.scriptSource]   scriptId → Skript-Inhalt (Test-Injektion).
 * @returns {(job: object) => Promise<{ code: number|null, timedOut: boolean }>}
 */
function createSshExecRunner(opts = {}) {
  const {
    privateKey,
    passphrase,
    hostKeys = {},
    allowedHosts = [],
    createClient = defaultCreateClient,
    scriptSource = defaultScriptSource,
  } = opts;

  if (!privateKey || (typeof privateKey !== 'string' && !Buffer.isBuffer(privateKey))) {
    throw new SshRunnerError('privateKey (In-Memory) ist erforderlich');
  }

  return async function runner({ host, user, port, env, scriptId, timeoutMs } = {}) {
    // Pre-Checks (fail-closed) — alle VOR jedem Verbindungsaufbau.
    assertHostAllowed(host, allowedHosts);
    const script = scriptSource(scriptId);                 // wirft bei unbekannter scriptId
    // Remote-Shell + ENV-Stil FEST je scriptId (nie aus Nutzereingabe). hasOwnProperty-Guard
    // gegen Prototype-Keys (auch wenn ein injizierter scriptSource sie durchließe).
    const shellMeta = Object.prototype.hasOwnProperty.call(SCRIPT_SHELL, String(scriptId))
      ? SCRIPT_SHELL[String(scriptId)] : null;
    if (!shellMeta) throw new SshRunnerError('unbekannte scriptId — kein Shell-Profil (Allowlist)');
    const expectedKey = hostKeys[String(host)];
    if (!expectedKey) throw new SshRunnerError('kein gepinnter Host-Key — Verbindung abgelehnt (fail-closed)');
    if (!HOSTKEY_HEX_RE.test(String(expectedKey))) {
      throw new SshRunnerError('gepinnter Host-Key ist kein gültiges SHA-256-Hex — Verbindung abgelehnt');
    }
    const preamble = buildEnvPreamble(env, shellMeta.envStyle); // wirft bei ENV-Injektion

    const totalTimeout = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const stdin = preamble + script;

    return runViaSsh({
      host: String(host),
      port: Number.isInteger(port) && port > 0 ? port : 22,
      username: String(user || 'root'),
      privateKey,
      passphrase,
      expectedKey,
      stdin,
      shell: shellMeta.shell,
      totalTimeout,
      createClient,
    });
  };
}

function runViaSsh(job) {
  const { host, port, username, privateKey, passphrase, expectedKey, stdin, shell, totalTimeout, createClient } = job;

  return new Promise((resolve, reject) => {
    const client = createClient();
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try { client.end(); } catch { /* Verbindung evtl. schon zu */ }
    };
    const done = (fn, arg) => { if (settled) return; settled = true; cleanup(); fn(arg); };

    timer = setTimeout(() => {
      logger.warn('ssh_exec_runner_timeout', { host, timeoutMs: totalTimeout });
      done(resolve, { code: null, timedOut: true });
    }, totalTimeout);

    client.on('error', (e) => {
      logger.warn('ssh_exec_runner_error', { host, message: e && e.message });
      done(reject, new SshRunnerError('SSH-Transport-Fehler'));
    });

    // Sauberer Verbindungsabbruch ohne vorheriges 'error' ⇒ sofort fail-closed,
    // nicht bis zum Timeout warten. Nach 'settled' ist es ein harmloses Nach-Close.
    client.on('close', () => {
      if (settled) return;
      logger.warn('ssh_exec_runner_closed_early', { host });
      done(reject, new SshRunnerError('SSH-Verbindung vorzeitig geschlossen'));
    });

    client.on('ready', () => {
      // ssh2-Netzwerk-API: Kommando auf dem Ziel-Host ausführen (KEIN lokaler Shell-Spawn).
      // `shell` ist die feste, je scriptId gewählte Remote-Shell (bash -s / powershell … -Command -).
      client.exec(shell, (err, stream) => {
        if (err) {
          logger.warn('ssh_exec_runner_exec_error', { host, message: err && err.message });
          done(reject, new SshRunnerError('SSH-Exec-Fehler'));
          return;
        }
        // stderr-Tail nur fürs SERVER-seitige Log behalten (begrenzt), NIE in den Return.
        let stderrTail = '';
        stream.on('close', (code) => {
          const exit = typeof code === 'number' ? code : null;
          if (exit !== 0 && stderrTail) {
            logger.warn('ssh_exec_runner_stderr', { host, code: exit, stderrTail });
          }
          logger.info('ssh_exec_runner_closed', { host, code: exit });
          done(resolve, { code: exit, timedOut: false });
        });
        // Remote-stdout NICHT behalten (kein Leak) — nur konsumieren.
        stream.on('data', () => {});
        if (stream.stderr && typeof stream.stderr.on === 'function') {
          stream.stderr.on('data', (chunk) => { stderrTail = (stderrTail + String(chunk)).slice(-STDERR_LOG_CAP); });
        }
        // ENV-Preamble + Installer über stdin an `bash -s`.
        stream.write(stdin);
        stream.end();
      });
    });

    const connectCfg = {
      host,
      port,
      username,
      privateKey,
      readyTimeout: Math.min(totalTimeout, CONNECT_TIMEOUT_CAP_MS),
      // Host-Key-Pinning: gegen den gepinnten SHA-256 prüfen; Mismatch/Unbekannt ⇒ ablehnen.
      hostVerifier: (keyBuf, cb) => {
        let ok = false;
        try { ok = timingSafeEqualHex(sha256Hex(keyBuf), String(expectedKey).toLowerCase()); }
        catch { ok = false; }
        if (typeof cb === 'function') return cb(ok);
        return ok;
      },
    };
    if (passphrase) connectCfg.passphrase = passphrase;

    try {
      client.connect(connectCfg);
    } catch (e) {
      logger.warn('ssh_exec_runner_connect_error', { host, message: e && e.message });
      done(reject, new SshRunnerError('SSH-Verbindungsfehler'));
    }
  });
}

module.exports = {
  createSshExecRunner,
  buildEnvPreamble,
  defaultScriptSource,
  assertHostAllowed,
  SshRunnerError,
  SCRIPT_ALLOWLIST,
};
