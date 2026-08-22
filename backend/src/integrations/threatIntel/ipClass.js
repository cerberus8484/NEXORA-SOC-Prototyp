'use strict';

// IP-Klassifizierung — entscheidet, ob eine IP überhaupt extern abgefragt werden darf.
// Private/Multicast/Reserved werden NIE an externe Provider geschickt (Quota + Sinn).

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const oct = (ip) => ip.split('.').map(Number);

function isPrivateV4(ip)   { return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip); }
function isMulticastV4(ip) { const a = Number(ip.split('.')[0]); return a >= 224 && a <= 239; }
function isReservedV4(ip) {
  const [a, b] = oct(ip);
  if (a === 0 || a === 127 || a >= 240) return true;        // this-net / loopback / reserved+broadcast
  if (a === 100 && b >= 64 && b <= 127) return true;        // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true;                     // 192.0.0.0/24, 192.0.2.0/24 (TEST-NET)
  if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18.0.0/15 (benchmark)
  return false;
}

function isPublicIp(ip) {
  const v = String(ip || '').trim();
  if (/:/.test(v)) return !/^(::1$|fe80|fc|fd)/i.test(v); // grobe IPv6-Heuristik
  if (!IPV4.test(v)) return false;
  if (!v.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255)) return false;
  return !isPrivateV4(v) && !isMulticastV4(v) && !isReservedV4(v);
}

module.exports = { isPublicIp, isPrivateV4, isMulticastV4, isReservedV4 };
