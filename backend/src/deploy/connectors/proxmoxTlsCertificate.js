'use strict';

const tls = require('tls');
const { X509Certificate } = require('crypto');

function assertPrivateIpv4(host, allowedHosts = []) {
  const parts = String(host).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error('Nur gespeicherte IPv4-Proxmox-Ziele sind erlaubt');
  const privateRange = parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  if (!privateRange || (parts[0] === 169 && parts[1] === 254)) throw new Error('Nur private PVE-Ziele sind erlaubt');
  if (allowedHosts.length > 0 && !allowedHosts.includes(String(host))) throw new Error('PVE-Ziel nicht in der Deploy-Allowlist');
}

function inspectProxmoxCertificate({ host, port = 8006, timeoutMs = 5000, allowedHosts = [] } = {}) {
  assertPrivateIpv4(host, allowedHosts);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false });
    const timer = setTimeout(() => socket.destroy(new Error('Zertifikatspruefung abgelaufen')), timeoutMs);
    socket.once('error', (error) => { clearTimeout(timer); reject(new Error(`PVE-Zertifikat nicht erreichbar: ${error.code || 'TLS_ERROR'}`)); });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      try {
        const raw = socket.getPeerCertificate(true).raw;
        if (!raw) throw new Error('Kein PVE-Zertifikat empfangen');
        const cert = new X509Certificate(raw);
        resolve({ fingerprint: cert.fingerprint256, pem: cert.toString(), validTo: cert.validTo });
      } catch (error) { reject(error); } finally { socket.end(); }
    });
  });
}

module.exports = { inspectProxmoxCertificate };
