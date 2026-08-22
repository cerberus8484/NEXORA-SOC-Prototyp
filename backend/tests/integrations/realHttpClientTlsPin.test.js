'use strict';

// RealHttpClient — TLS-Fingerprint-Pinning (Deployment Center / Proxmox).
//
// Hintergrund: der PVE-Node-Leaf ist CA-signiert (PVE Cluster Manager CA), nicht
// selbstsigniert, und Proxmox sendet nur den Leaf. `ca: leafPem` + rejectUnauthorized
// scheitert daher mit UNABLE_TO_VERIFY_LEAF_SIGNATURE — VOR jeder Fingerprint-Prüfung.
// Der Fix pinnt den SHA-256 direkt auf Socket-Ebene: genau EIN Zertifikat wird
// akzeptiert, jedes andere (Rotation/MITM) sofort verworfen (fail-closed).
//
// Das Test-Zertifikat ist selbstsigniert — der Pinning-Mechanismus ist chain-agnostisch,
// deshalb belegt es dieselbe Wirkung (zusätzlich empirisch gegen echtes PVE verifiziert).
// Es wird zur Laufzeit erzeugt (openssl, Temp-Dir) — KEIN Schlüsselmaterial im Repo.

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { X509Certificate } = require('crypto');
const { RealHttpClient } = require('../../src/integrations/http/RealHttpClient');

const WRONG_FP = 'AA:'.repeat(31) + 'AA';

let tmpDir; let server; let url; let FP;

function createTestCertificate(certPath, keyPath) {
  const args = [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', keyPath, '-out', certPath, '-subj', '/CN=nexora-tls-test',
  ];
  try {
    execFileSync('openssl', args, { stdio: 'ignore' });
    return;
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'ENOENT') throw error;
  }

  const toWslPath = (filePath) => {
    const { root } = path.win32.parse(filePath);
    const drive = root.slice(0, 1).toLowerCase();
    return `/mnt/${drive}/${filePath.slice(root.length).replaceAll('\\', '/')}`;
  };
  const wslArgs = args.map((arg, index) => (
    args[index - 1] === '-keyout' || args[index - 1] === '-out' ? toWslPath(arg) : arg
  ));
  execFileSync('wsl.exe', ['openssl', ...wslArgs], { stdio: 'ignore' });
}

beforeAll((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-tls-'));
  const certPath = path.join(tmpDir, 'cert.pem');
  const keyPath = path.join(tmpDir, 'key.pem');
  // Kein Shell-Aufruf: Zertifikate bleiben temporär; unter Windows wird WSL-OpenSSL verwendet.
  createTestCertificate(certPath, keyPath);
  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);
  FP = new X509Certificate(cert).fingerprint256;
  server = https.createServer({ cert, key }, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, '127.0.0.1', () => { url = `https://127.0.0.1:${server.address().port}/status`; done(); });
});

afterAll((done) => {
  if (!server) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    done();
    return;
  }
  server.close(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); done(); });
});

describe('RealHttpClient — TLS-Fingerprint-Pinning', () => {
  test('richtiger Pin: akzeptiert genau dieses Zertifikat (Chain irrelevant)', async () => {
    const client = new RealHttpClient({ pinnedFingerprint: FP });
    const res = await client.request(url);
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
  });

  test('falscher Pin: lehnt ab — kein blindes Vertrauen (fail-closed)', async () => {
    const client = new RealHttpClient({ pinnedFingerprint: WRONG_FP });
    await expect(client.request(url)).rejects.toThrow();
  });

  test('ohne Pin: selbstsigniertes Cert wird weiterhin abgelehnt (sichere Default bleibt)', async () => {
    const client = new RealHttpClient({}); // rejectUnauthorized default true, kein Pin
    await expect(client.request(url)).rejects.toThrow();
  });

  test('leerer Pin schaltet NICHT auf unsicher (kein versehentliches accept-all)', async () => {
    const client = new RealHttpClient({ pinnedFingerprint: '' });
    await expect(client.request(url)).rejects.toThrow();
  });
});
