'use strict';

/**
 * ownedAssets — Owned-Asset-Kontext für das AI Evidence Bundle.
 *
 * Ordnet eine IP einer Rolle zu (eigener Honeypot / internes Asset / extern),
 * damit die KI-Analyse weiß, mit wem sie es zu tun hat. Ohne dieses Wissen
 * liest die KI eine Kommunikation zum eigenen Honeypot als „unbekannte IP".
 *
 * Konfiguration kommt aus ENV (injizierbar für Tests):
 *   OWNED_HONEYPOT_IPS   = "31.70.103.246,10.0.10.80"   (exakte IPs)
 *   OWNED_INTERNAL_CIDRS = "10.0.10.0/24,192.168.0.0/16" (IPv4-CIDRs)
 *
 * Reine Logik (keine Seiteneffekte). IPv4 only — das Lab ist IPv4.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** @returns {number|null} 32-Bit-Integer der IPv4 oder null bei Ungültigkeit. */
function ipv4ToInt(ip) {
  const m = IPV4_RE.exec(String(ip ?? '').trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

/** @returns {boolean} true, wenn ip im CIDR-Block liegt. */
function ipInCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt   = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Kommaseparierte ENV-Liste → getrimmtes Array ohne Leereinträge. */
function _splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {Record<string,string>} [env]
 * @returns {{ honeypotIps: string[], internalCidrs: string[] }}
 */
function loadConfigFromEnv(env) {
  const source = env || (typeof process !== 'undefined' ? process.env : {});
  return {
    honeypotIps:   _splitList(source.OWNED_HONEYPOT_IPS),
    internalCidrs: _splitList(source.OWNED_INTERNAL_CIDRS),
  };
}

/**
 * Ordnet eine IP einer Asset-Rolle zu.
 *
 * @param {string} ip
 * @param {{ honeypotIps?: string[], internalCidrs?: string[] }} config
 * @returns {{ role: 'honeypot'|'internal'|'external', label: string }|null}
 *          null bei leerer/ungültiger IP.
 */
function classifyIp(ip, config = {}) {
  if (ipv4ToInt(ip) === null) return null;
  const value = String(ip).trim();

  const honeypotIps = config.honeypotIps || [];
  if (honeypotIps.includes(value)) {
    return { role: 'honeypot', label: 'eigener Honeypot (Decoy)' };
  }

  const internalCidrs = config.internalCidrs || [];
  if (internalCidrs.some((cidr) => ipInCidr(value, cidr))) {
    return { role: 'internal', label: 'internes Asset' };
  }

  return { role: 'external', label: 'extern' };
}

module.exports = { loadConfigFromEnv, classifyIp, ipInCidr, ipv4ToInt };
