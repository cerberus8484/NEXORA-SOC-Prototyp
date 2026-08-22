'use strict';

// Slice 6f: der echte Update-Runner-Bau. Fail-closed (kein Keypair / kein gepinnter
// Host-Key / keine IP) + Happy-Path (Runner aus Private-Key + Host-Key-Pin + Allowlist).
// Deps injiziert → keine echten Krypto-/SSH-Seiteneffekte.

const { buildDeployUpdateRunner } = require('../../src/services/nodeUpdateServiceFactory');

const NODE = { id: 'n1', os: 'windows', ip: '10.0.10.50', hostKeyPin: 'a'.repeat(64) };

describe('buildDeployUpdateRunner (Slice 6f)', () => {
  test('kein Platform-Keypair → E_NO_CHANNEL', async () => {
    await expect(buildDeployUpdateRunner(NODE, { resolvePrivateKey: async () => null, createRunner: () => {} }))
      .rejects.toMatchObject({ code: 'E_NO_CHANNEL' });
  });

  test('kein gepinnter Host-Key → E_NO_HOSTKEY (fail-closed, kein TOFU)', async () => {
    await expect(buildDeployUpdateRunner({ ...NODE, hostKeyPin: null }, { resolvePrivateKey: async () => 'KEY', createRunner: () => {} }))
      .rejects.toMatchObject({ code: 'E_NO_HOSTKEY' });
  });

  test('keine IP → E_NO_HOST', async () => {
    await expect(buildDeployUpdateRunner({ ...NODE, ip: null }, { resolvePrivateKey: async () => 'KEY', createRunner: () => {} }))
      .rejects.toMatchObject({ code: 'E_NO_HOST' });
  });

  test('happy: Runner aus Private-Key + gepinntem Host-Key + Host-Allowlist (Host = node.ip)', async () => {
    let seen = null;
    const runner = async () => ({ code: 0 });
    const res = await buildDeployUpdateRunner(NODE, { resolvePrivateKey: async () => 'PRIVATE-PEM', createRunner: (o) => { seen = o; return runner; } });
    expect(res).toBe(runner);
    expect(seen).toMatchObject({
      privateKey: 'PRIVATE-PEM',
      hostKeys: { '10.0.10.50': 'a'.repeat(64) },
      allowedHosts: ['10.0.10.50'],
    });
  });
});
