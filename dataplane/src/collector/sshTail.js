'use strict';

// ─────────────────────────────────────────────────────────────────────────
// SSH-Transport-Glue für die Stream-Pull-Quelle (ADR-036): read-only `tail -n0 -F`
// auf der Quelle, dessen stdout `createRemoteTailSource` zeilenweise zieht.
// `buildSshTailArgs` ist pur (testbar); `createSshTailOpenStream` bekommt `spawn`
// injiziert → testbar ohne echten Prozess. Default-Prod: `child_process.spawn`.
//
// Sicherheit: nur read-only `tail`; `logPath` wird streng validiert (keine Shell-
// Metazeichen) und single-gequotet → keine Command-Injection in die feindliche Quelle.
// ─────────────────────────────────────────────────────────────────────────

const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;
// StrictHostKeyChecking-Modi (Allowlist → kein Wert-Injection in die -o-Option).
// Default 'accept-new' (kein Verhaltenswechsel am laufenden Pull). Sobald die Host-Keys
// der Quellen in known_hosts liegen, kann der Operator pro Collector (ssh.strictHostKeyChecking)
// oder global (ENV COLLECTOR_SSH_STRICT_HOST_KEY) auf 'yes' härten.
const ALLOWED_HKC = new Set(['accept-new', 'yes', 'no', 'off', 'ask']);
// Quellseitiger Filter (tail | grep -E): nur Alphanum + . | - _ (IPs, Wörter wie "block", Alternation).
// KEINE Shell-Metazeichen (kein Space/;/$/`/Quote) → in einfachen Quotes injection-sicher.
const SAFE_FILTER = /^[A-Za-z0-9_.|-]+$/;

/**
 * Baut die ssh-argv für ein read-only remote-tail. Reiner String-Builder.
 * Optionaler `filter` → `tail … | grep --line-buffered -E '<filter>'` (quellseitiger Volumen-Scope,
 * z.B. für hochvolumige Quellen wie OPNsense-filterlog).
 * @param {{host:string, logPath:string, user?:string, port?:number,
 *   identityFile?:string, proxyJump?:string, proxyJumpKey?:string, filter?:string, serverAliveInterval?:number}} o
 * @returns {string[]}
 */
function buildSshTailArgs({ host, logPath, user, port, identityFile, proxyJump, proxyJumpKey, filter, serverAliveInterval = 15, strictHostKeyChecking = 'accept-new' } = {}) {
  if (!host || typeof host !== 'string') throw new Error('sshTail: host required');
  if (!logPath || typeof logPath !== 'string') throw new Error('sshTail: logPath required');
  if (!SAFE_PATH.test(logPath)) throw new Error('sshTail: logPath enthält unsichere Zeichen');
  if (filter !== undefined && filter !== null && filter !== '' && !SAFE_FILTER.test(filter)) {
    throw new Error('sshTail: filter enthält unsichere Zeichen');
  }
  const hkc = strictHostKeyChecking || 'accept-new';
  if (!ALLOWED_HKC.has(hkc)) {
    throw new Error('sshTail: strictHostKeyChecking ungültig (erlaubt: accept-new|yes|no|off|ask)');
  }

  const args = [
    '-o', 'BatchMode=yes',
    '-o', `StrictHostKeyChecking=${hkc}`,
    '-o', `ServerAliveInterval=${serverAliveInterval}`,
    '-o', 'ServerAliveCountMax=3',
  ];
  if (port) args.push('-p', String(port));
  if (identityFile) args.push('-i', identityFile);
  if (proxyJump) {
    // Innerer Jump-ssh: BatchMode + gleiches HostKey-Modus, weil im Container kein TTY zum Bestätigen ist.
    args.push('-o', `ProxyCommand=ssh -W %h:%p -o BatchMode=yes -o StrictHostKeyChecking=${hkc}${proxyJumpKey ? ` -i ${proxyJumpKey}` : ''} ${proxyJump}`);
  }
  args.push(`${user ? `${user}@` : ''}${host}`);
  const tailCmd = `tail -n0 -F '${logPath}'`;
  args.push(filter ? `${tailCmd} | grep --line-buffered -E '${filter}'` : tailCmd);
  return args;
}

/**
 * openStream-Factory für createRemoteTailSource. `spawn` injiziert (Prod: child_process.spawn).
 * @param {{spawn:Function, args:string[]}} o
 * @returns {(ctx:{signal?:AbortSignal}) => Promise<AsyncIterable>}
 */
function createSshTailOpenStream({ spawn, args } = {}) {
  if (typeof spawn !== 'function') throw new Error('sshTail: spawn required');
  return async ({ signal } = {}) => {
    const child = spawn('ssh', args);
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* schon beendet */ } };
    let onAbort = null;
    const detachAbort = () => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
    };
    if (signal) {
      if (signal.aborted) kill();
      else {
        onAbort = () => { detachAbort(); kill(); };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    if (typeof child.on === 'function') {
      child.on('close', detachAbort);
      child.on('exit', detachAbort);
      child.on('error', detachAbort);
    }
    return child.stdout;
  };
}

module.exports = { buildSshTailArgs, createSshTailOpenStream, SAFE_PATH, SAFE_FILTER };
