'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Echter SSH-Runner für den ssh-systemd-Adapter (Slice 2a, RCE-Fläche!).
// Getestet mit einem INJIZIERTEN Fake-ssh2-Client (kein echter Transport):
//   - scriptId-Allowlist (fail-closed bei unbekannt)
//   - SSRF-Host-Policy (Link-local/Metadata abgelehnt)
//   - Host-Key-Pinning (kein gepinnter Key ⇒ Verbindung abgelehnt, kein blindes TOFU)
//   - In-Memory-Key wird NIE auf Platte geschrieben (an ssh2 als privateKey übergeben)
//   - sichere ENV-Übergabe (export-Preamble, keine Shell-Command aus Nutzereingabe)
//   - Timeout, fail-closed, kein Leak roher Fehler/Secrets
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { EventEmitter } = require('events');
const {
  createSshExecRunner,
  SshRunnerError,
  buildEnvPreamble,
  defaultScriptSource,
} = require('../../src/deploy/adapters/sshExecRunner');

const PRIV = '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE-IN-MEMORY-KEY\n-----END OPENSSH PRIVATE KEY-----';
const HOST = '10.0.10.90';
const SERVER_KEY = Buffer.from('server-public-key-bytes');
const PINNED = crypto.createHash('sha256').update(SERVER_KEY).digest('hex');
const ENV_OK = { WAZUH_MANAGER: '10.0.10.77', WAZUH_AGENT_NAME: 'web01', WAZUH_AGENT_VERSION: '4.14.6' };

/** Fake-ssh2-Client, gesteuert über ein Szenario. Zeichnet connect-Config + stdin auf. */
function makeFakeFactory(scenario = {}) {
  const state = { created: 0, connectCfg: null, execCmd: null, stdin: '', ended: false };
  const factory = () => {
    state.created += 1;
    const client = new EventEmitter();
    client.connect = (cfg) => {
      state.connectCfg = cfg;
      setImmediate(() => {
        if (scenario.connectError) { client.emit('error', new Error(scenario.connectError)); return; }
        if (scenario.closeWithoutReady) { client.emit('close'); return; } // sauberer Abbruch ohne error/ready
        const keyBuf = scenario.hostKey || SERVER_KEY;
        cfg.hostVerifier(keyBuf, (ok) => {
          if (!ok) { client.emit('error', new Error('handshake failed')); return; }
          client.emit('ready');
        });
      });
    };
    client.exec = (cmd, cb) => {
      state.execCmd = cmd;
      if (scenario.execError) { cb(new Error(scenario.execError)); return; }
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.write = (d) => { state.stdin += String(d); };
      stream.end = () => {};
      cb(null, stream);
      if (scenario.hang) return; // nie 'close' ⇒ Timeout-Pfad
      setImmediate(() => {
        if (scenario.stderr) stream.stderr.emit('data', Buffer.from(scenario.stderr));
        if (scenario.stdout) stream.emit('data', Buffer.from(scenario.stdout));
        stream.emit('close', scenario.exitCode == null ? 0 : scenario.exitCode);
      });
    };
    client.end = () => { state.ended = true; };
    return client;
  };
  factory.state = state;
  return factory;
}

const scriptSourceOk = (id) => {
  if (id !== 'install-wazuh-agent') throw new SshRunnerError('unbekannte scriptId');
  return '#!/usr/bin/env bash\nset -euo pipefail\necho install\n';
};

function makeRunner(scenario, overrides = {}) {
  const createClient = makeFakeFactory(scenario);
  const runner = createSshExecRunner({
    privateKey: PRIV,
    hostKeys: { [HOST]: PINNED },
    createClient,
    scriptSource: scriptSourceOk,
    ...overrides,
  });
  return { runner, state: createClient.state };
}

const RUN = { host: HOST, user: 'root', port: 22, env: ENV_OK, scriptId: 'install-wazuh-agent', timeoutMs: 2000 };

describe('buildEnvPreamble — sichere ENV-Übergabe', () => {
  test('gültige ENV ⇒ single-quoted export-Zeilen', () => {
    const p = buildEnvPreamble({ WAZUH_MANAGER: '10.0.10.77', WAZUH_AGENT_NAME: 'web01' });
    expect(p).toContain("export WAZUH_MANAGER='10.0.10.77'");
    expect(p).toContain("export WAZUH_AGENT_NAME='web01'");
  });

  test('ungültiger ENV-Key (Kleinbuchstaben/Space) wird abgelehnt', () => {
    expect(() => buildEnvPreamble({ 'bad key': 'x' })).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ lower: 'x' })).toThrow(SshRunnerError);
  });

  test('ENV-Wert mit Shell-Metazeichen/Quote/Newline wird abgelehnt (bash-Injektion)', () => {
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: "10.0.0.1'; rm -rf /" })).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: '10.0.0.1`id`' })).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: '10.0.0.1\nexport EVIL=1' })).toThrow(SshRunnerError);
  });

  test('style=powershell: gültig → $env: · PowerShell-Injektion (Quote/Backtick/$()/Newline) abgelehnt', () => {
    expect(buildEnvPreamble({ WAZUH_MANAGER: '10.0.10.77' }, 'powershell')).toContain("$env:WAZUH_MANAGER='10.0.10.77'");
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: "10.0.0.1'; rm" }, 'powershell')).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: '10.0.0.1`whoami`' }, 'powershell')).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: '10.0.0.1$(id)' }, 'powershell')).toThrow(SshRunnerError);
    expect(() => buildEnvPreamble({ WAZUH_MANAGER: '10.0.0.1\n$env:EVIL=1' }, 'powershell')).toThrow(SshRunnerError);
  });
});

describe('defaultScriptSource — Allowlist', () => {
  test("'install-wazuh-agent' liefert den echten Installer-Inhalt", () => {
    const content = defaultScriptSource('install-wazuh-agent');
    expect(content).toContain('wazuh-agent');
    expect(content.length).toBeGreaterThan(100);
  });

  test("'install-wazuh-agent-windows' liefert den PowerShell-Installer", () => {
    const content = defaultScriptSource('install-wazuh-agent-windows');
    expect(content).toContain('WAZUH_MANAGER');
    expect(content).toMatch(/msiexec|Wazuh/i);
    expect(content.length).toBeGreaterThan(100);
  });

  test("'update-wazuh-agent' liefert den Linux-Update-Bash-Installer", () => {
    const content = defaultScriptSource('update-wazuh-agent');
    expect(content).toContain('wazuh-agent');
    expect(content.length).toBeGreaterThan(100);
  });

  test('unbekannte scriptId ⇒ fail-closed (wirft)', () => {
    expect(() => defaultScriptSource('../../etc/passwd')).toThrow(SshRunnerError);
    expect(() => defaultScriptSource('rm-rf')).toThrow(SshRunnerError);
  });

  test('Prototype-Keys (__proto__/constructor/toString) ⇒ explizit abgelehnt (kein Zufalls-Fangen)', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(() => defaultScriptSource(id)).toThrow(/unbekannte scriptId/);
    }
  });
});

describe('createSshExecRunner — Konstruktion', () => {
  test('ohne privateKey ⇒ wirft (kein Runner ohne Key)', () => {
    expect(() => createSshExecRunner({ hostKeys: { [HOST]: PINNED } })).toThrow(SshRunnerError);
  });
});

describe('runner — Ausführung über injizierten ssh2-Fake', () => {
  test('Erfolg (Exit 0) ⇒ {code:0}; In-Memory-Key + bash -s + ENV-Preamble über stdin', async () => {
    const { runner, state } = makeRunner({ exitCode: 0 });
    const res = await runner(RUN);
    expect(res).toMatchObject({ code: 0, timedOut: false });
    // In-Memory-Key an ssh2 (nie Dateipfad/Disk)
    expect(state.connectCfg.privateKey).toBe(PRIV);
    expect(state.connectCfg).toMatchObject({ host: HOST, port: 22, username: 'root' });
    expect(typeof state.connectCfg.hostVerifier).toBe('function');
    // bash -s (pipefail ist bashism), NICHT sh
    expect(state.execCmd).toBe('bash -s');
    // ENV kam als Preamble über stdin, dazu das Skript
    expect(state.stdin).toContain("export WAZUH_MANAGER='10.0.10.77'");
    expect(state.stdin).toContain("export WAZUH_AGENT_NAME='web01'");
    expect(state.stdin).toContain('echo install');
  });

  test('Windows-scriptId ⇒ powershell-Shell + $env:-Preamble (statt bash/export)', async () => {
    const winSource = (id) => { if (id !== 'install-wazuh-agent-windows') throw new SshRunnerError('unbekannt'); return '# ps1 installer\nWrite-Host hi\n'; };
    const { runner, state } = makeRunner({ exitCode: 0 }, { scriptSource: winSource });
    const res = await runner({ ...RUN, scriptId: 'install-wazuh-agent-windows' });
    expect(res).toMatchObject({ code: 0 });
    expect(state.execCmd).toMatch(/^powershell /);            // NICHT bash -s
    expect(state.stdin).toContain("$env:WAZUH_MANAGER='10.0.10.77'");
    expect(state.stdin).not.toContain('export WAZUH_MANAGER');
    expect(state.stdin).toContain('ps1 installer');
  });

  test('Non-Zero-Exit ⇒ {code:1} (Adapter mappt auf install_failed)', async () => {
    const { runner } = makeRunner({ exitCode: 1, stderr: 'apt failed /opt/secret' });
    const res = await runner(RUN);
    expect(res.code).toBe(1);
    // roher stderr wird NICHT zurückgegeben (kein Leak)
    expect(JSON.stringify(res)).not.toContain('/opt/secret');
  });

  test('unbekannte scriptId ⇒ fail-closed VOR Verbindungsaufbau (Client nie erzeugt)', async () => {
    const { runner, state } = makeRunner({}, { scriptSource: defaultScriptSource });
    await expect(runner({ ...RUN, scriptId: 'evil' })).rejects.toThrow(SshRunnerError);
    expect(state.created).toBe(0);
  });

  test('SSRF: Link-local/Metadata-Host (169.254.169.254) ⇒ abgelehnt, kein Connect', async () => {
    const { runner, state } = makeRunner({}, { hostKeys: { '169.254.169.254': PINNED } });
    await expect(runner({ ...RUN, host: '169.254.169.254' })).rejects.toThrow(SshRunnerError);
    expect(state.created).toBe(0);
  });

  test('kein gepinnter Host-Key ⇒ fail-closed (kein TOFU), kein Connect', async () => {
    const { runner, state } = makeRunner({}, { hostKeys: {} });
    await expect(runner(RUN)).rejects.toThrow(SshRunnerError);
    expect(state.created).toBe(0);
  });

  test('Host-Key-Mismatch ⇒ Verbindung abgelehnt (fail-closed)', async () => {
    const wrong = crypto.createHash('sha256').update(Buffer.from('anderer-key')).digest('hex');
    const { runner } = makeRunner({ exitCode: 0 }, { hostKeys: { [HOST]: wrong } });
    await expect(runner(RUN)).rejects.toThrow(SshRunnerError);
  });

  test('gepinnter Host-Key kein gültiges SHA-256-Hex ⇒ fail-closed VOR Connect (Fehlkonfiguration explizit)', async () => {
    const { runner, state } = makeRunner({ exitCode: 0 }, { hostKeys: { [HOST]: 'nicht-hex' } });
    await expect(runner(RUN)).rejects.toThrow(SshRunnerError);
    expect(state.created).toBe(0);
  });

  test('sauberer Verbindungsabbruch ohne Error-Event (close) ⇒ fail-closed statt Warten bis Timeout', async () => {
    const { runner } = makeRunner({ closeWithoutReady: true });
    const err = await runner({ ...RUN, timeoutMs: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(SshRunnerError);
  });

  test('ENV-Injektion (Wert mit Metazeichen) ⇒ fail-closed VOR Connect', async () => {
    const { runner, state } = makeRunner({ exitCode: 0 });
    await expect(runner({ ...RUN, env: { WAZUH_MANAGER: '10.0.0.1; id' } })).rejects.toThrow(SshRunnerError);
    expect(state.created).toBe(0);
  });

  test('Timeout (Skript hängt) ⇒ {timedOut:true} und Verbindung geschlossen', async () => {
    const { runner, state } = makeRunner({ hang: true });
    const res = await runner({ ...RUN, timeoutMs: 60 });
    expect(res).toMatchObject({ timedOut: true });
    expect(state.ended).toBe(true);
  });

  test('Connect-Fehler ⇒ generischer SshRunnerError, KEIN Leak (Key-Pfad/ECONNREFUSED)', async () => {
    const { runner } = makeRunner({ connectError: 'connect ECONNREFUSED key=/root/.ssh/id_ed25519' });
    const err = await runner(RUN).catch((e) => e);
    expect(err).toBeInstanceOf(SshRunnerError);
    expect(err.message).not.toContain('ECONNREFUSED');
    expect(err.message).not.toContain('id_ed25519');
  });
});
