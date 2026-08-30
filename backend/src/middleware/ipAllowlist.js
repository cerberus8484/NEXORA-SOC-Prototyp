'use strict';

// Reiner IPv4-CIDR-Matcher — keine externen Deps (transitive ipaddr.js wird
// bewusst NICHT genutzt, damit der Deploy nicht an einer indirekten Dep hängt).
//
// Unterstützt einzelne IPv4-Adressen und CIDR-Notation (a.b.c.d/n).
// IPv6 wird NICHT unterstützt — das interne Lab ist IPv4. Eine IPv6-Quelle
// matcht nie und wird bei aktiver Allowlist abgewiesen (fail-closed bei aktiver Liste).

/** Wandelt eine IPv4-Adresse in eine vorzeichenlose 32-Bit-Zahl. null bei ungültig. */
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let int = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    int = (int * 256) + n;
  }
  return int >>> 0;
}

/** Normalisiert IPv4-mapped IPv6 (::ffff:1.2.3.4) auf reine IPv4. */
function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  const trimmed = ip.trim();
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1] : trimmed;
}

/** Prüft, ob eine IP in einem einzelnen CIDR-/IP-Eintrag liegt. */
function matchesCidr(ip, cidr) {
  const entry = String(cidr).trim();
  if (!entry) return false;

  const [range, bitsRaw] = entry.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt    = ipv4ToInt(normalizeIp(ip));
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  if (bits === 0) return true; // 0.0.0.0/0 — alles
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/** Zerlegt eine durch Komma/Zeilenumbruch getrennte CIDR-Liste in ein Array. */
function parseCidrList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

/** True, wenn die IP in mindestens einem Eintrag der Allowlist liegt. */
function ipInAllowlist(ip, cidrList) {
  const list = Array.isArray(cidrList) ? cidrList : parseCidrList(cidrList);
  return list.some((cidr) => matchesCidr(ip, cidr));
}

module.exports = { ipv4ToInt, normalizeIp, matchesCidr, parseCidrList, ipInAllowlist };
