'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { getEventListeners } = require('node:events');
const { buildSshTailArgs, createSshTailOpenStream } = require('../src/collector/sshTail');

async function* streamOf(chunks) { for (const c of chunks) yield c; }

test('buildSshTailArgs: read-only tail, BatchMode, Key, Port, ProxyJump, gequoteter Pfad', () => {
  const args = buildSshTailArgs({
    host: '10.99.77.1', user: 'nexora', port: 64222,
    identityFile: '/keys/id', proxyJump: 'root@10.99.99.1', proxyJumpKey: '/keys/jump',
    logPath: '/var/log/cowrie/cowrie.json',
  });
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(args.includes('-i') && args.includes('/keys/id'));
  assert.ok(args.includes('-p') && args.includes('64222'));
  assert.ok(args.some((a) => a.includes('ProxyCommand') && a.includes('root@10.99.99.1') && a.includes('/keys/jump')));
  assert.ok(args.includes('nexora@10.99.77.1'));
  // letztes Argument = read-only tail-Kommando, Pfad gequotet
  assert.match(args[args.length - 1], /tail -n0 -F '\/var\/log\/cowrie\/cowrie\.json'/);
});

test('buildSshTailArgs: lehnt unsichere Pfade ab (kein Shell-Injection)', () => {
  assert.throws(() => buildSshTailArgs({ host: 'h', logPath: "/a'; rm -rf /" }), /logPath/);
});

test('buildSshTailArgs: optionaler Filter → tail | grep (quellseitig, Volumen-Scope)', () => {
  const args = buildSshTailArgs({ host: 'h', logPath: '/var/log/filter/latest.log', filter: 'block|10.99.99.75' });
  assert.match(args[args.length - 1], /^tail -n0 -F '\/var\/log\/filter\/latest\.log' \| grep --line-buffered -E 'block\|10\.99\.99\.75'$/);
});

test('buildSshTailArgs: unsicherer Filter abgelehnt (kein Injection)', () => {
  assert.throws(() => buildSshTailArgs({ host: 'h', logPath: '/x', filter: 'a; rm -rf /' }), /filter/);
  assert.throws(() => buildSshTailArgs({ host: 'h', logPath: '/x', filter: "x' ; id #" }), /filter/);
});

test('buildSshTailArgs: StrictHostKeyChecking default accept-new, per Option auf yes härtbar', () => {
  const def = buildSshTailArgs({ host: 'h', logPath: '/x' });
  assert.ok(def.includes('StrictHostKeyChecking=accept-new'));
  const hard = buildSshTailArgs({ host: 'h', logPath: '/x', strictHostKeyChecking: 'yes', proxyJump: 'r@j' });
  assert.ok(hard.includes('StrictHostKeyChecking=yes'));
  // ProxyCommand erbt denselben Modus
  assert.ok(hard.some((a) => a.includes('ProxyCommand') && a.includes('StrictHostKeyChecking=yes')));
});

test('buildSshTailArgs: ungültiger StrictHostKeyChecking-Wert abgelehnt (kein -o-Injection)', () => {
  assert.throws(() => buildSshTailArgs({ host: 'h', logPath: '/x', strictHostKeyChecking: 'no -o ProxyCommand=evil' }), /strictHostKeyChecking/);
});

test('buildSshTailArgs: host ist Pflicht', () => {
  assert.throws(() => buildSshTailArgs({ logPath: '/x' }), /host/);
  assert.throws(() => buildSshTailArgs({ host: 'h' }), /logPath/);
});

test('createSshTailOpenStream: spawnt ssh + liefert stdout-Stream', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args) => { calls.push({ cmd, args }); return { stdout: streamOf(['a\n']), kill: () => {} }; };
  const openStream = createSshTailOpenStream({ spawn: fakeSpawn, args: ['x@h', "tail -n0 -F '/p'"] });
  const stream = await openStream({});
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.strictEqual(calls[0].cmd, 'ssh');
  assert.deepStrictEqual(calls[0].args, ['x@h', "tail -n0 -F '/p'"]);
  assert.deepStrictEqual(chunks, ['a\n']);
});

test('createSshTailOpenStream: AbortSignal killt den Child-Prozess', async () => {
  const ctrl = new AbortController();
  let killed = null;
  const fakeSpawn = () => ({ stdout: streamOf([]), kill: (sig) => { killed = sig || 'SIGTERM'; } });
  const openStream = createSshTailOpenStream({ spawn: fakeSpawn, args: [] });
  await openStream({ signal: ctrl.signal });
  ctrl.abort();
  assert.ok(killed, 'child wurde bei Abort gekillt');
});

test('createSshTailOpenStream: räumt Abort-Listener nach Child-Ende wieder auf', async () => {
  const ctrl = new AbortController();
  const listenersBefore = getEventListeners(ctrl.signal, 'abort').length;
  let closeHandler = null;
  const fakeSpawn = () => ({
    stdout: streamOf([]),
    kill: () => {},
    on: (event, handler) => { if (event === 'close') closeHandler = handler; },
  });
  const openStream = createSshTailOpenStream({ spawn: fakeSpawn, args: [] });
  await openStream({ signal: ctrl.signal });
  assert.strictEqual(getEventListeners(ctrl.signal, 'abort').length, listenersBefore + 1);
  closeHandler?.();
  assert.strictEqual(getEventListeners(ctrl.signal, 'abort').length, listenersBefore);
});

test('createSshTailOpenStream: spawn ist Pflicht', () => {
  assert.throws(() => createSshTailOpenStream({ args: [] }), /spawn/);
});
