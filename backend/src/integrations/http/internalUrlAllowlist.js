'use strict';

const dns = require('dns');
const net = require('net');

// SSRF-Schutz (geteilt): eine per Admin-UI konfigurierbare Ziel-URL darf NUR auf
// localhost oder einen RFC-1918-Host zeigen (interne Dienste: Ollama, Wazuh-API,
// Wazuh-Indexer, …). Single Source of Truth — ollamaUrlAllowlist re-exportiert
// diese Regex, damit alle UI-konfigurierbaren URLs konsistent gehärtet sind.
const INTERNAL_URL_ALLOWLIST = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d{1,5})?(\/.*)?$/;

function isInternalHttpUrl(url) {
  return typeof url === 'string' && INTERNAL_URL_ALLOWLIST.test(url);
}

// SSRF-Deny-List für Ziele, die auch dann NIE erlaubt sind, wenn ein externer Host
// legitim ist (z.B. QRadar kann on-prem RFC-1918 ODER extern sein → keine Allowlist
// möglich, aber diese Sonderbereiche bleiben tabu): Loopback, Link-local + Cloud-
// Metadaten (169.254.169.254), 0.0.0.0, sowie Hostnamen localhost/metadata.
const _SSRF_BLOCKED = [
  /^0\.0\.0\.0$/,
  /^127\./,                 // 127.0.0.0/8 loopback
  /^169\.254\./,            // link-local + Cloud-Metadaten
  /^(localhost|metadata(\.google\.internal)?)$/i,
  /^\[?::1\]?$/,            // IPv6 loopback
  /^\[?fe80:/i,             // IPv6 link-local
];

function _stripIpv6Brackets(host) {
  return host.replace(/^\[/, '').replace(/\]$/, '');
}

function _isLiteralIp(host) {
  return net.isIP(_stripIpv6Brackets(host)) !== 0;
}

function _mappedIpv4(host) {
  const h = _stripIpv6Brackets(host).toLowerCase();
  const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const value = ((Number.parseInt(hex[1], 16) << 16) | Number.parseInt(hex[2], 16)) >>> 0;
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/** true, wenn ein (bloßer) Hostname/IP auf einen SSRF-gefährlichen Sonderbereich zeigt.
 *  Für Nicht-HTTP-Ziele (z.B. IMAP über rohes TCP), die keinen URL-Parse zulassen. */
function isBlockedSsrfHost(host) {
  if (typeof host !== 'string' || host === '') return false;
  const h = _stripIpv6Brackets(host.trim().toLowerCase());
  const mappedIpv4 = _mappedIpv4(h);
  if (mappedIpv4) return isBlockedSsrfHost(mappedIpv4);
  if (h === '::') return true;
  return _SSRF_BLOCKED.some((re) => re.test(h));
}

/** Async-Variante mit DNS-Auflösung: blockt auch Hostnamen, die auf Loopback,
 *  Link-local/Metadata oder 0.0.0.0 zeigen. RFC-1918 bleibt erlaubt, weil Nexora
 *  bewusst interne Enterprise-/Lab-Ziele wie QRadar, Wazuh oder OTRS anbinden kann. */
async function isBlockedSsrfHostResolved(host) {
  if (isBlockedSsrfHost(host)) return true;
  if (typeof host !== 'string' || host.trim() === '') return false;

  const h = _stripIpv6Brackets(host.trim().toLowerCase());
  if (_isLiteralIp(h)) return false;

  let records;
  try {
    records = await dns.promises.lookup(h, { all: true, verbatim: true });
  } catch {
    // Fail-closed: was wir nicht auflösen können, können wir nicht bewerten — also
    // blocken. Wichtig bei IMAP: dort ist DIESE Vorprüfung die einzige Absicherung
    // (kein HTTP-Connect-Guard). Der GRUND ist über ssrfBlockReason() abfragbar,
    // damit Routen „nicht auflösbar" nicht als „Loopback/Metadaten" ausgeben.
    return true;
  }

  return records.some((record) => isBlockedSsrfHost(record.address));
}

/** true, wenn die URL auf einen für SSRF gefährlichen Sonderbereich zeigt. */
function isBlockedSsrfUrl(url) {
  if (typeof url !== 'string' || url === '') return false;
  let host;
  try { host = new URL(url).hostname; } catch { return true; } // unparsebar → blocken
  return isBlockedSsrfHost(host);
}

/** Async-Variante mit DNS-Auflösung für Admin-konfigurierbare HTTP(S)-Ziele. */
async function isBlockedSsrfUrlResolved(url) {
  if (isBlockedSsrfUrl(url)) return true;
  let host;
  try { host = new URL(url).hostname; } catch { return true; }
  return isBlockedSsrfHostResolved(host);
}

/**
 * Wie `isBlockedSsrfUrlResolved`, benennt aber den GRUND — für aussagekräftige
 * Fehlermeldungen. Trifft exakt dieselbe Blockier-Entscheidung (keine Schutzlücke).
 *
 *   'policy'       → zeigt auf Loopback/Link-local/Metadaten oder ist unparsebar
 *                    (echtes SSRF-Risiko)
 *   'unresolvable' → DNS liefert nichts: Tippfehler im Hostnamen oder ein interner
 *                    Name, den dieser Container nicht auflösen kann
 *   null           → nicht blockiert
 *
 * @param {string} url
 * @returns {Promise<'policy'|'unresolvable'|null>}
 */
async function ssrfBlockReason(url) {
  if (typeof url !== 'string' || url === '') return null;
  if (isBlockedSsrfUrl(url)) return 'policy';          // unparsebar oder Sonderbereich

  let host;
  try { host = new URL(url).hostname; } catch { return 'policy'; }

  const h = _stripIpv6Brackets(String(host).trim().toLowerCase());
  if (_isLiteralIp(h)) return null;                    // Literal-IP: oben schon geprüft

  let records;
  try {
    records = await dns.promises.lookup(h, { all: true, verbatim: true });
  } catch {
    return 'unresolvable';
  }
  return records.some((r) => isBlockedSsrfHost(r.address)) ? 'policy' : null;
}

function createSsrfSafeLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true }, (error, records = []) => {
      if (error) return callback(error);
      if (!Array.isArray(records) || records.length === 0) {
        const err = new Error('DNS-Aufloesung lieferte keine Adresse');
        err.code = 'E_SSRF_DNS_EMPTY';
        return callback(err);
      }
      if (records.some((record) => isBlockedSsrfHost(record.address))) {
        const err = new Error('DNS-Zieladresse ist durch SSRF-Policy blockiert');
        err.code = 'E_SSRF_BLOCKED';
        return callback(err);
      }

      const family = Number(options?.family) || 0;
      const selected = records.find((record) => family === 0 || record.family === family) || records[0];
      if (options?.all) return callback(null, records);
      return callback(null, selected.address, selected.family);
    });
  };
}

// Warnung, wenn Zugangsdaten unverschlüsselt (http://) an ein NICHT-internes Ziel
// gingen: extern ist Klartext-Übertragung Credential-Exposure. Intern (localhost/
// RFC-1918) ist http akzeptabel (kein Warntext). https und unparsebare/leere URLs →
// keine Warnung. Non-blocking: nur ein Hinweis fürs Frontend, kein Verbot.
const PLAINTEXT_CRED_WARNING =
  'Unverschlüsselte Verbindung (http) zu einem externen Ziel — Zugangsdaten würden im Klartext übertragen. Bitte https verwenden.';

/** @returns {string|null} Warntext bei http:// zu externem Ziel, sonst null. */
function plaintextCredentialWarning(url) {
  if (typeof url !== 'string' || !/^http:\/\//i.test(url)) return null; // https/leer/unparsebar → keine Klartext-Warnung
  if (isInternalHttpUrl(url)) return null;                              // internes Ziel (RFC-1918/localhost) → akzeptabel
  return PLAINTEXT_CRED_WARNING;
}

module.exports = {
  INTERNAL_URL_ALLOWLIST,
  isInternalHttpUrl,
  isBlockedSsrfUrl,
  isBlockedSsrfHost,
  isBlockedSsrfHostResolved,
  isBlockedSsrfUrlResolved,
  ssrfBlockReason,
  createSsrfSafeLookup,
  plaintextCredentialWarning,
};
