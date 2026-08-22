'use strict';

/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Linux-Client Deploy — End-to-End Smoke (echter ssh2-Transport, KEIN Docker/Prod).
//
// Beweist die komplette agent-install-Kette gegen einen ISOLIERTEN, in-process
// ssh2-Server (spielt den Ziel-Host) mit dem ECHTEN Transport + Host-Key-Pinning:
//   createConnector(ssh, verschlüsselt) → createSpec(linux-client) → plan → approve
//   → apply → executeAgentInstall → makeSshRunner → sshExecRunner (ssh2) verbindet
//   sich, pint den Host-Key, führt `bash -s` aus, Ergebnis wird gemappt.
//
// Pflichtpfade:
//   1. Erfolg (Server Exit 0)      → run = deployed
//   2. Fehler (Server Exit 1)      → run = rolled_back (fail-closed, kein Safety-Lock)
//   3. Host-Key-Mismatch (Bad-Pin) → run = rolled_back (Handshake abgelehnt)
//
// DEPLOY_ENABLED wird NUR in diesem Prozess gesetzt (verschwindet beim Exit). InMemory-
// Repo (kein DB/Docker nötig). Der ssh2-Server nimmt stdin entgegen und liefert nur den
// Exitcode — der reale Wazuh-Install läuft NICHT (das ist der spätere Prod-Live-Smoke
// mit echtem Host + explizitem GO). Hier geht es um Transport + Orchestrierung.
// ─────────────────────────────────────────────────────────────────────────────

process.env.DEPLOY_ENABLED = 'true';                 // nur in diesem ephemeren Prozess
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-only-secret-not-for-prod-usage-32+';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const crypto = require('crypto');
const { Server, Client, utils: sshUtils } = require('ssh2');

const { DeployService } = require('../src/deploy/DeployService');
const { InMemoryDeployRepository } = require('../src/deploy/InMemoryDeployRepository');
const { makeSshRunner } = require('../src/deploy/connectors/sshRunnerFactory');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓ PASS' : '  ✗ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ── In-process ssh2-Ziel-Server (spielt den Linux-Host) ──────────────────────
function startTargetServer(hostKeyPrivate) {
  const state = { exitCode: 0, execs: 0 };
  const server = new Server({ hostKeys: [hostKeyPrivate] }, (client) => {
    client.on('authentication', (ctx) => {
      // Nur Publickey akzeptieren (der Runner nutzt den injizierten In-Memory-Key).
      if (ctx.method === 'publickey') return ctx.accept();
      return ctx.reject(['publickey']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec) => {
          state.execs += 1;
          const stream = acceptExec();
          stream.on('data', () => {});               // stdin (ENV-Preamble + Skript) konsumieren
          stream.stderr.on('error', () => {});
          const finish = () => { try { stream.exit(state.exitCode); stream.end(); } catch { /* schon zu */ } };
          stream.on('end', finish);                  // Client-EOF nach stream.end()
          setTimeout(finish, 1500);                  // Fallback, falls kein 'end' kommt
        });
      });
    });
    client.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

// „Lernt" den Host-Key-Pin (SHA-256), wie man ihn beim ersten Enrollment erfassen würde.
function probeHostKeyPin(host, port, clientPrivateKey) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let pin = null;
    c.on('ready', () => { c.end(); resolve(pin); });
    c.on('error', reject);
    c.connect({
      host, port, username: 'root', privateKey: clientPrivateKey, readyTimeout: 8000,
      hostVerifier: (keyBuf, cb) => { pin = crypto.createHash('sha256').update(keyBuf).digest('hex'); cb(true); },
    });
  });
}

// ── Reale DeployService-Kette (InMemory-Repo, echter SSH-Runner) ─────────────
const stubAuth = { verifyDeployReauth: (token, sub) => ({ ok: token === 'good' && sub === 'u-bob', sub }) };
const ALICE = { id: 'u-alice', label: 'alice' };
const BOB = { id: 'u-bob', label: 'bob' };

function makeService() {
  const repo = new InMemoryDeployRepository();
  const svc = new DeployService({
    repo,
    authService: stubAuth,
    connectorFactory: () => { throw new Error('proxmox-Connector im Linux-Client-Smoke nicht genutzt'); },
    isDeployEnabled: () => true,
    sshRunnerFactory: (row) => makeSshRunner(row),      // ECHTER ssh2-Runner
  });
  return { repo, svc };
}

// Fährt einen kompletten Deploy-Run und gibt den End-Status zurück.
async function runDeploy(svc, { host, port, clientKey, pin, moduleId = 'linux-client' }) {
  const conn = await svc.createConnector(
    { type: 'ssh', name: `smoke-${port}-${moduleId}`, host, sshUser: 'root', sshPort: port, privateKey: clientKey, hostKeyPin: pin },
    ALICE,
  );
  const spec = await svc.createSpec(
    { moduleId, connectorId: conn.id, params: { targetHost: host, sshPort: port, wazuhManager: '10.0.10.77', agentName: 'smoke-agent' } },
    ALICE,
  );
  const { run } = await svc.plan(spec.id, ALICE);
  await svc.approve(run.id, BOB);
  const result = await svc.apply(run.id, BOB, 'good');
  return result.status;
}

async function main() {
  console.log('== Linux-Client Deploy Smoke (echter ssh2-Transport, in-process) ==');
  const hostKey = sshUtils.generateKeyPairSync('ed25519');   // Server-Host-Key
  const clientKey = sshUtils.generateKeyPairSync('ed25519'); // Client-Key (In-Memory)
  const { server, port, state } = await startTargetServer(hostKey.private);

  try {
    const pin = await probeHostKeyPin('127.0.0.1', port, clientKey.private);
    check('Host-Key-Pin erfasst (SHA-256, 64 hex)', /^[a-f0-9]{64}$/.test(pin || ''), pin ? pin.slice(0, 12) + '…' : 'null');

    // 1. Erfolgsweg (Linux-Client / bash)
    state.exitCode = 0;
    const { svc: svc1 } = makeService();
    const s1 = await runDeploy(svc1, { host: '127.0.0.1', port, clientKey: clientKey.private, pin });
    check('Linux-Client: Erfolg (Server Exit 0) → deployed', s1 === 'deployed', `status=${s1}`);

    // 1b. Windows-Client (ssh-powershell / powershell -Command -) — shell-aware Kette
    state.exitCode = 0;
    const { svc: svcW } = makeService();
    const sW = await runDeploy(svcW, { host: '127.0.0.1', port, clientKey: clientKey.private, pin, moduleId: 'windows-client' });
    check('Windows-Client: Erfolg (Server Exit 0) → deployed', sW === 'deployed', `status=${sW}`);

    // 2. Fehlerweg
    state.exitCode = 1;
    const { svc: svc2 } = makeService();
    const s2 = await runDeploy(svc2, { host: '127.0.0.1', port, clientKey: clientKey.private, pin });
    check('Fehler (Server Exit 1) → rolled_back', s2 === 'rolled_back', `status=${s2}`);

    // 3. Host-Key-Mismatch
    state.exitCode = 0;
    const badPin = crypto.createHash('sha256').update('anderer-key').digest('hex');
    const { svc: svc3 } = makeService();
    const s3 = await runDeploy(svc3, { host: '127.0.0.1', port, clientKey: clientKey.private, pin: badPin });
    check('Host-Key-Mismatch (Bad-Pin) → rolled_back (fail-closed)', s3 === 'rolled_back', `status=${s3}`);

    check('Der Ziel-Server wurde real kontaktiert (>=1 exec)', state.execs >= 1, `execs=${state.execs}`);
  } finally {
    server.close();
  }

  console.log(`\n== ${failures === 0 ? 'ALLE PFLICHTPFADE GRÜN' : failures + ' FEHLGESCHLAGEN'} ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Smoke-Fehler:', e && e.stack ? e.stack : e); process.exit(1); });
