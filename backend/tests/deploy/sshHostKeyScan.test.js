'use strict';

// Slice 6b: Host-Key-Scan-Primitive. Erfasst den SSH-Host-Key + bildet den Pin
// (SHA-256, identisch zu sshExecRunner). Getestet mit injiziertem Fake-ssh2-Client:
// Erfolg (Pin), Host unerreichbar (Fehler), SSRF-Block, ungültiger Host.

const crypto = require('crypto');
const { scanHostKeyPin, HostKeyScanError } = require('../../src/deploy/adapters/sshHostKeyScan');

// Fake-ssh2-Client: feuert hostVerifier mit keyBuf, dann 'error' (Key abgelehnt) —
// bzw. simuliert einen Verbindungsfehler VOR dem hostVerifier (Host down).
function fakeClient({ keyBuf, hostDown = false } = {}) {
  return class {
    constructor() { this._h = {}; }
    on(ev, cb) { this._h[ev] = cb; return this; }
    connect(opts) {
      if (hostDown) { setImmediate(() => this._h.error && this._h.error(new Error('ECONNREFUSED'))); return; }
      opts.hostVerifier(keyBuf, () => {}); // Key erfassen, Verbindung ablehnen
      setImmediate(() => this._h.error && this._h.error(new Error('host key rejected')));
    }
    end() {} destroy() {}
  };
}

describe('scanHostKeyPin', () => {
  test('erfasst den Host-Key → Pin = SHA-256(keyBuf) hex (identisch zum Runner)', async () => {
    const keyBuf = Buffer.from('ssh-ed25519 AAAA...fake-host-key');
    const pin = await scanHostKeyPin({ host: '10.0.10.50', ClientCtor: fakeClient({ keyBuf }) });
    expect(pin).toBe(crypto.createHash('sha256').update(keyBuf).digest('hex'));
    expect(pin).toMatch(/^[0-9a-f]{64}$/);
  });

  test('Host unerreichbar (kein hostVerifier) → HostKeyScanError E_SCAN_FAILED', async () => {
    await expect(scanHostKeyPin({ host: '10.0.10.51', ClientCtor: fakeClient({ hostDown: true }) }))
      .rejects.toMatchObject({ code: 'E_SCAN_FAILED' });
  });

  test('SSRF-gesperrter Host (Loopback/Metadaten) → E_BLOCKED, ohne zu verbinden', async () => {
    let connected = false;
    const Spy = class { on() { return this; } connect() { connected = true; } end() {} destroy() {} };
    await expect(scanHostKeyPin({ host: '127.0.0.1', ClientCtor: Spy })).rejects.toMatchObject({ code: 'E_BLOCKED' });
    await expect(scanHostKeyPin({ host: '169.254.169.254', ClientCtor: Spy })).rejects.toMatchObject({ code: 'E_BLOCKED' });
    expect(connected).toBe(false);
  });

  test('ungültiger Host / Port → HostKeyScanError (fail-fast)', async () => {
    await expect(scanHostKeyPin({ host: '10.0.0.1; rm', ClientCtor: fakeClient({}) })).rejects.toBeInstanceOf(HostKeyScanError);
    await expect(scanHostKeyPin({ host: '10.0.0.1', port: 70000, ClientCtor: fakeClient({}) })).rejects.toMatchObject({ code: 'E_BAD_PORT' });
  });
});
