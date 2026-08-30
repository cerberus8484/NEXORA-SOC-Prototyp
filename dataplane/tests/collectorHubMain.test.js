'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildHubFromConfig, loadHubConfig, findWeakHostKeyCollectors } = require('../src/collector/collectorHubMain');
const { createCowrieCollector } = require('../src/collector/cowrieCollector');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');

async function* streamOf(chunks) { for (const c of chunks) yield c; }
const COWRIE_LINE = JSON.stringify({ eventid: 'cowrie.login.failed', src_ip: '198.51.100.9', session: 's1', timestamp: '2026-06-24T21:00:00.000Z', sensor: 'hp' });

function tailConfig() {
  return {
    intakeUrl: 'http://intake:8081/v1/intake/events',
    collectors: [{
      name: 'hp-cowrie', kind: 'cowrie', options: { honeypotIp: '192.0.2.10' }, credential: 'CRED_COWRIE',
      source: { mode: 'tail', ssh: { host: '10.99.77.1', user: 'root', port: 64222, identityFile: '/k', proxyJump: 'root@10.99.99.1', proxyJumpKey: '/j' }, logPath: '/var/log/cowrie/cowrie.json' },
    }],
  };
}

test('validiert config (intakeUrl · collectors[] · source.mode)', () => {
  assert.throws(() => buildHubFromConfig({}, {}), /intakeUrl/);
  assert.throws(() => buildHubFromConfig({ intakeUrl: 'u' }, {}), /collectors/);
  assert.throws(() => buildHubFromConfig({ intakeUrl: 'u', collectors: [{ name: 'a', kind: 'cowrie', source: {} }] }, {}), /mode/);
});

test('tail-Quelle: spawnt read-only ssh-tail + Envelope trägt das per-spec Credential', async () => {
  const captured = []; const ctrl = new AbortController(); const spawnArgs = []; let spawns = 0;
  const spawn = (cmd, args) => {
    spawns += 1; spawnArgs.push({ cmd, args }); if (spawns >= 2) ctrl.abort();
    return { stdout: spawns === 1 ? streamOf([`${COWRIE_LINE}\n`]) : streamOf([]), kill: () => {} };
  };
  const hub = buildHubFromConfig(tailConfig(), {
    buildCollector: (s) => createCowrieCollector({ instanceId: s.name, honeypotIp: s.options.honeypotIp }),
    spawn,
    wait: async () => {},
    makeEmitter: () => (env, spec) => { captured.push({ env, credential: spec.credential }); },
  });
  hub.start({ signal: ctrl.signal });
  await hub.wait();

  assert.strictEqual(spawnArgs[0].cmd, 'ssh');
  assert.ok(spawnArgs[0].args.some((a) => /tail -n0 -F '\/var\/log\/cowrie\/cowrie\.json'/.test(a)));
  assert.strictEqual(captured.length, 1);
  assert.ok(validateEnvelope(captured[0].env).valid);
  assert.strictEqual(captured[0].env.source.vendor, 'cowrie');
  assert.strictEqual(captured[0].credential, 'CRED_COWRIE');
});

test('poll-Quelle: nutzt fetchSince + intervalMs aus der config', async () => {
  const ctrl = new AbortController(); let n = 0; const captured = [];
  const fetchSince = async () => { n += 1; if (n >= 2) ctrl.abort(); return { records: [{ id: n }], cursor: null }; };
  const cfg = { intakeUrl: 'u', collectors: [{ name: 'api', kind: 'x', credential: 'C', source: { mode: 'poll', intervalMs: 5, fetchSince } }] };
  const passPlugin = { name: 'api', domain: 'siem', source: { type: 'siem', vendor: 'x', instanceId: 'api' }, parserVersion: '0.1.0',
    normalize: (it) => (it ? { observedAt: '2026-06-24T21:00:00.000Z', rawHash: 'a'.repeat(64), rawRef: 'r', entities: [{ type: 'ip', value: '198.51.100.1', role: 'source' }], confidence: 1 } : null) };
  const hub = buildHubFromConfig(cfg, {
    buildCollector: () => passPlugin,
    spawn: () => { throw new Error('kein ssh für poll'); },
    wait: async () => {},
    makeEmitter: () => (env) => captured.push(env),
  });
  hub.start({ signal: ctrl.signal });
  await hub.wait();
  assert.ok(captured.length >= 1);
  assert.ok(captured.every((e) => validateEnvelope(e).valid));
});

test('loadHubConfig: parst JSON (readFileSync injiziert); Fehler bei kaputtem JSON / fehlendem Pfad', () => {
  const cfg = loadHubConfig('/x.json', { readFileSync: () => '{"intakeUrl":"u","collectors":[]}' });
  assert.deepStrictEqual(cfg, { intakeUrl: 'u', collectors: [] });
  assert.throws(() => loadHubConfig('/x.json', { readFileSync: () => '{nope' }), /ungültiges JSON/);
  assert.throws(() => loadHubConfig('', {}), /Pfad/);
});

test('findWeakHostKeyCollectors: meldet nur tail-Collector mit accept-new', () => {
  const cfg = {
    intakeUrl: 'u',
    collectors: [
      { name: 'cowrie-a', source: { mode: 'tail', ssh: { strictHostKeyChecking: 'accept-new' } } },
      { name: 'cowrie-b', source: { mode: 'tail', ssh: { strictHostKeyChecking: 'yes' } } },
      { name: 'poll-a', source: { mode: 'poll' } },
      { name: 'tail-global', source: { mode: 'tail', ssh: {} } },
    ],
  };

  const weak = findWeakHostKeyCollectors(cfg, { COLLECTOR_SSH_STRICT_HOST_KEY: 'accept-new' });
  assert.deepStrictEqual(weak, [
    { name: 'cowrie-a', mode: 'accept-new' },
    { name: 'tail-global', mode: 'accept-new' },
  ]);

  const hardened = findWeakHostKeyCollectors(cfg, { COLLECTOR_SSH_STRICT_HOST_KEY: 'yes' });
  assert.deepStrictEqual(hardened, [{ name: 'cowrie-a', mode: 'accept-new' }]);
});

test('unbekannter source.mode → der Collector schlägt isoliert fehl (Status failed)', async () => {
  const cfg = { intakeUrl: 'u', collectors: [{ name: 'weird', kind: 'x', credential: 'C', source: { mode: 'carrier-pigeon' } }] };
  const hub = buildHubFromConfig(cfg, { buildCollector: () => ({}), spawn: () => ({}), makeEmitter: () => () => {} });
  hub.start();
  await hub.wait();
  assert.strictEqual(hub.status()[0].status, 'failed');
});
