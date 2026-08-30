'use strict';

// RFC 6238 (TOTP) + RFC 4648 (Base32) — reine Funktionen, keine externe Abhängigkeit.
// Krypto über Node 'crypto' (konsistent zu secretsCrypto.js / ApiToken.js): kleinere
// Supply-Chain-Fläche, und gegen die offiziellen RFC-6238-Testvektoren verifiziert
// (interoperabel mit Google Authenticator / Authy etc.).
//
// Bewusst NUR die Krypto-Primitive — kein DB-/Login-/Route-Touch. Enrollment-Domäne,
// Repos und Login-Challenge kommen als eigener Schritt.

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648, ohne Padding
const DEFAULTS = { step: 30, digits: 6, algorithm: 'sha1' };

/** Kodiert einen Buffer als Base32-String (RFC 4648, ohne Padding). */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Dekodiert einen Base32-String zurück zu einem Buffer. Wirft bei ungültigem Zeichen. */
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Ungültiges Base32-Zeichen');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues TOTP-Secret als Base32 (Default 20 Byte = 160 bit, RFC-Empfehlung). */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** RFC 6238: TOTP-Code für einen Zeitpunkt (time = Unix-Sekunden, Default jetzt). */
function totpToken(secret, opts = {}) {
  const { step, digits, algorithm } = { ...DEFAULTS, ...opts };
  const time = opts.time != null ? opts.time : Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / step);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm, base32Decode(secret)).update(counterBuf).digest();
  // Dynamic Truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
            | ((hmac[offset + 1] & 0xff) << 16)
            | ((hmac[offset + 2] & 0xff) << 8)
            | (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Verifiziert ein Token gegen ±window Zeitschritte (Default ±1 = ±30 s Drift-Toleranz).
 * Konstantzeit-Vergleich; nicht-numerische Eingabe wird abgelehnt.
 */
function verifyToken(secret, token, opts = {}) {
  const { step, digits, algorithm } = { ...DEFAULTS, ...opts };
  const window = opts.window != null ? opts.window : 1;
  const time = opts.time != null ? opts.time : Math.floor(Date.now() / 1000);

  const candidate = String(token == null ? '' : token).trim();
  if (!/^\d+$/.test(candidate)) return false;

  for (let w = -window; w <= window; w++) {
    const expected = totpToken(secret, { step, digits, algorithm, time: time + w * step });
    if (expected.length === candidate.length
        && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return true;
    }
  }
  return false;
}

/** otpauth://-URI für QR-Codes (Authenticator-Apps). */
function otpauthUri(secret, { label = 'user', issuer = 'Nexora SOC' } = {}) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: DEFAULTS.algorithm.toUpperCase(),
    digits: String(DEFAULTS.digits),
    period: String(DEFAULTS.step),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, totpToken, verifyToken, otpauthUri };
