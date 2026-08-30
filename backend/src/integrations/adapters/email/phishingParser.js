'use strict';

/**
 * phishingParser.js — Reines Phishing-Triage-Parser-Modul
 *
 * Extraktion von IOCs und Indikatoren aus einer Roh-E-Mail (Header + Body + Anhang-Metadaten).
 * KEIN Netz, KEINE DB, KEINE externen Pakete.
 *
 * Security-Hinweise:
 * - Alle Regex begrenzt auf sichere Muster (kein katastrophales Backtracking).
 * - Input wird auf Maximallängen gecapped, bevor Regex läuft (ReDoS-Schutz).
 * - Keine Ausführung/Eval von Mail-Inhalten.
 * - Bei Müll-Input: kein Throw — leere/teilweise Struktur + parseError-Flag.
 *
 * MITRE ATT&CK: T1566 (Phishing), T1204 (User Execution)
 *
 * @param {*} rawEmail - Beliebiges Objekt; wird intern typisiert/gecapped.
 * @returns {PhishingParseResult}
 */

// ─── Längen-Caps (ReDoS-Schutz) ─────────────────────────────────────────────
const MAX_HEADER_LEN = 2_000;
const MAX_BODY_LEN   = 50_000;
const MAX_ITEMS      = 50;

// ─── Bekannte URL-Shortener-Domains ─────────────────────────────────────────
const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
  'buff.ly', 'adf.ly', 'tiny.cc', 'shorturl.at', 'rb.gy', 'cutt.ly',
  'qr.ae', 'clck.ru', 'hubs.la', 'soo.gd', 'su.pr', 'twit.ac',
  'dlvr.it', 'lnkd.in', 'mcaf.ee', 'bl.ink',
]);

// ─── Ausführbare / gefährliche Erweiterungen ─────────────────────────────────
const EXECUTABLE_EXTS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'vbs', 'js', 'jse', 'ps1', 'psm1', 'msi',
  'scr', 'hta', 'pif', 'com', 'reg', 'lnk', 'inf', 'cpl', 'msc',
  'iso', 'img', 'jar', 'wsf',
]);

// ─── Regex-Definitionen ───────────────────────────────────────────────────────
// IPv4 — sichere Variante ohne katastrophales Backtracking
const RE_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

// E-Mail-Adresse — begrenzt, kein .*+-Backtracking
const RE_EMAIL = /\b[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,24}\b/g;

// URL (http/https/ftp) — Länge der Authority + Pfad beschränkt
const RE_URL = /\bhttps?:\/\/[^\s"'<>]{4,500}/gi;

// Defanged URL: hxxp oder h[tt]p oder http[://]
// Nur das echte, balancierte Defang-Pattern http[://] — die frühere Alternative
// `[://` (unbalanciert) ist kein reales Defang und wurde von normalizeUrl ohnehin
// nicht vollständig zurückgebaut → entfernt.
const RE_URL_DEFANGED = /\bhxxps?:\/\/[^\s"'<>]{4,500}|\bh\[tt\]ps?:\/\/[^\s"'<>]{4,500}|\bhttps?\[:\/\/\][^\s"'<>]{4,500}/gi;

// Hash — MD5 (32), SHA1 (40), SHA256 (64), SHA512 (128)
const RE_HASH_MD5    = /\b[0-9a-fA-F]{32}\b/g;
const RE_HASH_SHA1   = /\b[0-9a-fA-F]{40}\b/g;
const RE_HASH_SHA256 = /\b[0-9a-fA-F]{64}\b/g;
const RE_HASH_SHA512 = /\b[0-9a-fA-F]{128}\b/g;

// Domain — konservative Variante (max. 253 Zeichen gesamt, max. 63 pro Label)
const RE_DOMAIN = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}\b/g;

// Doppelte Extension: z.B. "invoice.pdf.exe", "document.docx.lnk"
const RE_DOUBLE_EXT = /\.\w{2,5}\.(exe|dll|bat|cmd|vbs|js|jse|ps1|msi|scr|hta|pif|com|lnk|wsf)\b/i;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/**
 * Wandelt beliebigen Input in einen String um, gecapped auf maxLen.
 * Gibt '' zurück bei null/undefined/nicht-string-fähig.
 */
function toSafeString(val, maxLen) {
  if (val == null) return '';
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Extrahiert den Domain-Teil aus einer E-Mail-Adresse.
 * Gibt null zurück wenn kein '@' gefunden.
 */
function domainFromEmail(emailStr) {
  const idx = emailStr.lastIndexOf('@');
  if (idx < 0) return null;
  return emailStr.slice(idx + 1).toLowerCase();
}

/**
 * Extrahiert den Display-Name aus einem RFC 5322-Absender-String.
 *
 * Unterstützt:
 *  - "Display Name <addr@domain.tld>"
 *  - "Display Name" <addr@domain.tld>
 *  - addr@domain.tld
 *  - Komplexe Formen: '"Display <nested@x.com>" <real@y.com>'
 *    → Display Name = alles vor dem letzten '<', Address = letztes <...>-Paar
 */
function parseFromHeader(fromStr) {
  // Letztes <...>-Paar finden — das ist stets die echte Adresse.
  const lastOpen  = fromStr.lastIndexOf('<');
  const lastClose = fromStr.lastIndexOf('>');

  if (lastOpen >= 0 && lastClose > lastOpen) {
    const address     = fromStr.slice(lastOpen + 1, lastClose).trim();
    const displayRaw  = fromStr.slice(0, lastOpen).trim();
    // Äußere Anführungszeichen entfernen
    const displayName = displayRaw.replace(/^"(.*)"$/, '$1').trim();
    return { displayName, address };
  }

  return { displayName: '', address: fromStr.trim() };
}

/**
 * Normalisiert eine URL: defangt → refangt, lowercase Authority, trimmt trailing punkt.
 */
function normalizeUrl(raw) {
  return raw
    .replace(/^hxxp/i, 'http')
    .replace(/^h\[tt\]p/i, 'http')
    // Defang-Klammern generisch zurückbauen — wohldefiniert, keine Null-Breite-Matches.
    .replace(/\[:\/\/\]/g, '://')   // http[://]example → http://example
    .replace(/\[:\]/g, ':')         // http[:]//example → http://example
    .replace(/\[\/\]/g, '/')        // [/] → /
    .replace(/\[\.\]/g, '.')        // domain[.]tld → domain.tld
    .replace(/\.$/, '');
}

/**
 * Extrahiert den Hostnamen aus einer URL (ohne Port, ohne Pfad).
 * Gibt null zurück bei Parsing-Fehlern.
 */
function hostFromUrl(url) {
  // Einfaches Split — kein URL-Objekt (würde Ausnahmen bei invalid URLs werfen)
  const m = url.match(/^https?:\/\/([^/:?#]{1,253})/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

/**
 * Überprüft ob ein Domain-String Punycode-Labels (xn--) enthält.
 */
function isPunycode(domain) {
  return /(?:^|\.)xn--/i.test(domain);
}

/**
 * Überprüft ob ein Anhang-Dateiname eine gefährliche oder doppelte Extension hat.
 * Gibt { dangerous: bool, doubleExt: bool, ext: string } zurück.
 */
function analyzeAttachmentName(name) {
  const n = name.trim();
  const doubleExt = RE_DOUBLE_EXT.test(n);
  RE_DOUBLE_EXT.lastIndex = 0; // Regex-State zurücksetzen

  const lastDot = n.lastIndexOf('.');
  const ext = lastDot >= 0 ? n.slice(lastDot + 1).toLowerCase() : '';
  const dangerous = EXECUTABLE_EXTS.has(ext);

  return { dangerous, doubleExt, ext };
}

/**
 * Parst den Authentication-Results-Header.
 * Extrahiert SPF/DKIM/DMARC-Ergebnisse.
 */
function parseAuthResults(headerVal) {
  // Nur die ausgewerteten Verdikte zurückgeben — den rohen Header (kann
  // Empfänger-/Server-PII tragen, wird nirgends gelesen) NICHT mitschleppen.
  const result = { spf: null, dkim: null, dmarc: null };

  if (!headerVal) return result;

  const safe = toSafeString(headerVal, MAX_HEADER_LEN).toLowerCase();

  // SPF: "spf=pass" / "spf=fail" / "spf=softfail" / "spf=neutral" / "spf=none"
  const spfM = safe.match(/\bspf=(pass|fail|softfail|neutral|none|temperror|permerror)\b/);
  if (spfM) result.spf = spfM[1];

  // DKIM: "dkim=pass" / "dkim=fail" / "dkim=none"
  const dkimM = safe.match(/\bdkim=(pass|fail|none|temperror|permerror|policy)\b/);
  if (dkimM) result.dkim = dkimM[1];

  // DMARC: "dmarc=pass" / "dmarc=fail" / "dmarc=none"
  const dmarcM = safe.match(/\bdmarc=(pass|fail|none|temperror|permerror)\b/);
  if (dmarcM) result.dmarc = dmarcM[1];

  return result;
}

/**
 * Extrahiert URLs aus Text (echte + defangte).
 * Normalisiert auf http-Format, dedupliziert.
 */
function extractUrls(text) {
  const found = [];
  const seen  = new Set();

  // Echter URLs
  const realMatches = text.match(RE_URL) || [];
  // Defangte URLs
  const defangedMatches = text.match(RE_URL_DEFANGED) || [];

  for (const raw of [...realMatches, ...defangedMatches]) {
    const norm = normalizeUrl(raw);
    if (!seen.has(norm)) {
      seen.add(norm);
      found.push(norm);
    }
  }

  return found.slice(0, MAX_ITEMS);
}

/**
 * Extrahiert Hashes aus Text. Klassifiziert nach Länge.
 */
function extractHashes(text) {
  const found = [];
  const seen  = new Set();

  const addHashes = (matches, hashType) => {
    for (const m of (matches || [])) {
      const lower = m.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        found.push({ type: 'hash', hashType, value: lower });
      }
    }
  };

  addHashes(text.match(RE_HASH_SHA512), 'sha512');
  addHashes(text.match(RE_HASH_SHA256), 'sha256');
  addHashes(text.match(RE_HASH_SHA1),   'sha1');
  addHashes(text.match(RE_HASH_MD5),    'md5');

  return found.slice(0, MAX_ITEMS);
}

/**
 * Extrahiert Domains aus Text (ohne IP-Adressen, ohne bereits extrahierte URL-Hosts).
 */
function extractDomains(text, knownIps, knownUrlHosts) {
  const ipSet      = new Set(knownIps);
  const urlHostSet = new Set(knownUrlHosts);

  // ReDoS-Schutz: überlange Nicht-Whitespace-Token (>253 Z., kein gültiger
  // Hostname) vor dem Domain-Match strippen — verhindert pathologisches
  // Backtracking von RE_DOMAIN auf präparierten Eingaben.
  const safe    = text.replace(/\S{254,}/g, ' ');
  const matches = safe.match(RE_DOMAIN) || [];
  const seen    = new Set();
  const found   = [];

  for (const d of matches) {
    const lower = d.toLowerCase();
    if (!seen.has(lower) && !ipSet.has(lower) && !urlHostSet.has(lower)) {
      seen.add(lower);
      found.push(lower);
    }
  }

  return found.slice(0, MAX_ITEMS);
}

// ─── Haupt-Exportfunktion ─────────────────────────────────────────────────────

/**
 * Parst eine Roh-E-Mail und extrahiert strukturierte Phishing-IOCs und Indikatoren.
 *
 * @param {object} rawEmail - Mail-Objekt mit optionalen Feldern:
 *   from, replyTo, returnPath, subject, body (oder text),
 *   headers (Objekt: 'Authentication-Results' etc.),
 *   attachments (Array: [{name, hash, size}])
 * @returns {PhishingParseResult}
 */
function parsePhishingEmail(rawEmail) {
  // ── Basis-Guard ──────────────────────────────────────────────────────────
  const EMPTY_RESULT = {
    sender:       null,
    replyTo:      null,
    returnPath:   null,
    authResults:  { spf: null, dkim: null, dmarc: null },
    urls:         [],
    attachments:  [],
    indicators:   [],
    iocs:         [],
    parseError:   false,
  };

  if (!rawEmail || typeof rawEmail !== 'object' || Array.isArray(rawEmail)) {
    return { ...EMPTY_RESULT, parseError: true };
  }

  try {
    return _parse(rawEmail, EMPTY_RESULT);
  } catch (err) {
    // Pures Modul → kein Logger hier. Ursache mitgeben, damit der Aufrufer
    // (Pipeline) sie loggen kann — kein still verschluckter Fehler.
    return { ...EMPTY_RESULT, parseError: true, parseErrorMessage: err && err.message ? err.message : 'unknown' };
  }
}

function _parse(mail, empty) {
  // ── Input-Extraktion + Längen-Caps ───────────────────────────────────────
  const rawFrom        = toSafeString(mail.from,       MAX_HEADER_LEN);
  const rawReplyTo     = toSafeString(mail.replyTo,    MAX_HEADER_LEN);
  const rawReturnPath  = toSafeString(mail.returnPath, MAX_HEADER_LEN);
  const rawSubject     = toSafeString(mail.subject,    MAX_HEADER_LEN);
  const rawBody        = toSafeString(mail.body || mail.text, MAX_BODY_LEN);

  // Headers: Objekt oder leer
  const headers = (mail.headers && typeof mail.headers === 'object' && !Array.isArray(mail.headers))
    ? mail.headers
    : {};

  // Attachments: Array oder leer
  const rawAttachments = Array.isArray(mail.attachments) ? mail.attachments : [];

  // ── Absender ─────────────────────────────────────────────────────────────
  const senderParsed     = rawFrom     ? parseFromHeader(rawFrom)     : null;
  const replyToParsed    = rawReplyTo  ? parseFromHeader(rawReplyTo)  : null;
  const returnPathParsed = rawReturnPath
    ? { displayName: '', address: rawReturnPath.replace(/[<>]/g, '').trim() }
    : null;

  const sender     = senderParsed     ? { ...senderParsed,     domain: domainFromEmail(senderParsed.address)     } : null;
  const replyTo    = replyToParsed    ? { ...replyToParsed,    domain: domainFromEmail(replyToParsed.address)    } : null;
  const returnPath = returnPathParsed ? { ...returnPathParsed, domain: domainFromEmail(returnPathParsed.address) } : null;

  // ── Authentication-Results ────────────────────────────────────────────────
  const authResultsRaw = toSafeString(
    headers['Authentication-Results'] || headers['authentication-results'] || '',
    MAX_HEADER_LEN,
  );
  const authResults = parseAuthResults(authResultsRaw);

  // ── Text-Haystack für IOC-Extraktion (Subject + Body) ─────────────────────
  const haystack = `${rawSubject} ${rawBody}`.slice(0, MAX_BODY_LEN + MAX_HEADER_LEN);

  // ── IPs ───────────────────────────────────────────────────────────────────
  const ips      = [...new Set(haystack.match(RE_IPV4) || [])].slice(0, MAX_ITEMS);

  // ── URLs ──────────────────────────────────────────────────────────────────
  const rawUrls  = extractUrls(haystack);
  const urlHosts = rawUrls.map(hostFromUrl).filter(Boolean);

  // ── Hashes ────────────────────────────────────────────────────────────────
  const hashes   = extractHashes(haystack);

  // ── E-Mail-Adressen aus Body ──────────────────────────────────────────────
  const bodyEmails = [...new Set(haystack.match(RE_EMAIL) || [])].slice(0, MAX_ITEMS);

  // ── Domains (ohne IP-Überlappung, ohne URL-Hosts bereits gesehen) ─────────
  const domains  = extractDomains(haystack, ips, urlHosts);

  // ── Anhänge ───────────────────────────────────────────────────────────────
  const attachments = rawAttachments.slice(0, MAX_ITEMS).map((att) => {
    if (!att || typeof att !== 'object') return null;
    const name     = toSafeString(att.name || att.filename || '', 500);
    const hash     = toSafeString(att.hash || att.sha256 || att.md5 || '', 200);
    const size     = typeof att.size === 'number' ? att.size : null;
    const mimeType = toSafeString(att.mimeType || att.contentType || '', 200);
    const analysis = name ? analyzeAttachmentName(name) : { dangerous: false, doubleExt: false, ext: '' };

    return { name, hash, size, mimeType, ...analysis };
  }).filter(Boolean);

  // ── Indikator-Bewertung ───────────────────────────────────────────────────
  const indicators = [];

  // 1) Display-Name-Spoofing: From-Displayname enthält einen anderen Domain-Namen
  //    als die tatsächliche From-Adresse, oder enthält eine eingebettete E-Mail-Adresse
  //    einer anderen Domain (z.B. "IT-Support <ceo@trusted.com>" <attacker@evil.ru>).
  if (sender && sender.displayName) {
    const dnLower    = sender.displayName.toLowerCase();
    const fromDomain = (sender.domain || '').toLowerCase();

    // Domains aus dem Display-Namen (Regex-Reset nötig da globale Flag)
    const dnDomainMatches = [];
    let dm;
    const reDomainCopy = new RegExp(RE_DOMAIN.source, 'gi');
    while ((dm = reDomainCopy.exec(dnLower)) !== null) {
      dnDomainMatches.push(dm[0].toLowerCase());
    }

    // Eingebettete E-Mail-Adressen aus dem Display-Namen
    const dnEmailMatches = [];
    let em;
    const reEmailCopy = new RegExp(RE_EMAIL.source, 'gi');
    while ((em = reEmailCopy.exec(dnLower)) !== null) {
      dnEmailMatches.push(em[0].toLowerCase());
    }

    // Spoofing wenn Display-Name eine andere Domain referenziert als der echte Absender
    const spoofedByDomain = dnDomainMatches.some(
      (d) => d !== fromDomain && d.length > 4 && !fromDomain.endsWith(`.${d}`) && !d.endsWith(`.${fromDomain}`),
    );
    // Oder wenn Display-Name eine eingebettete E-Mail einer anderen Domain enthält
    const spoofedByEmail = dnEmailMatches.some((e) => {
      const eDomain = domainFromEmail(e);
      return eDomain && eDomain !== fromDomain;
    });

    if (spoofedByDomain || spoofedByEmail) {
      const refDomain = spoofedByEmail
        ? domainFromEmail(dnEmailMatches[0])
        : dnDomainMatches.find((d) => d !== fromDomain);
      indicators.push({
        type:        'display_name_spoofing',
        description: `Display-Name referenziert Domain "${refDomain}" aber Absender ist "${fromDomain}"`,
        severity:    'high',
      });
    }
  }

  // 2) From ≠ Return-Path Mismatch
  if (sender && returnPath && sender.domain && returnPath.domain) {
    if (sender.domain.toLowerCase() !== returnPath.domain.toLowerCase()) {
      indicators.push({
        type:        'from_returnpath_mismatch',
        description: `From-Domain "${sender.domain}" stimmt nicht mit Return-Path-Domain "${returnPath.domain}" überein`,
        severity:    'high',
      });
    }
  }

  // 3) Punycode/IDN-Domain in URLs oder Absender-Domain
  const allDomainsForCheck = [
    ...(sender?.domain ? [sender.domain] : []),
    ...(replyTo?.domain ? [replyTo.domain] : []),
    ...urlHosts,
    ...domains.slice(0, 20),
  ];
  for (const d of allDomainsForCheck) {
    if (isPunycode(d)) {
      indicators.push({
        type:        'punycode_domain',
        description: `Punycode/IDN-Domain erkannt: "${d}" (mögliches Homoglyph-Spoofing)`,
        severity:    'high',
        value:       d,
      });
    }
  }

  // 4) URL-Shortener
  for (const url of rawUrls) {
    const host = hostFromUrl(url);
    if (host && URL_SHORTENERS.has(host.toLowerCase())) {
      indicators.push({
        type:        'url_shortener',
        description: `URL-Shortener erkannt: "${host}" (Ziel-URL verschleiert)`,
        severity:    'medium',
        value:       url,
      });
    }
  }

  // 5) Ausführbare Anhänge / Doppel-Extension
  for (const att of attachments) {
    if (att.doubleExt) {
      indicators.push({
        type:        'double_extension_attachment',
        description: `Anhang mit Doppel-Extension erkannt: "${att.name}"`,
        severity:    'high',
        value:       att.name,
      });
    } else if (att.dangerous) {
      indicators.push({
        type:        'executable_attachment',
        description: `Ausführbarer Anhang erkannt: "${att.name}" (Extension: .${att.ext})`,
        severity:    'high',
        value:       att.name,
      });
    }
  }

  // 6) Auth-Fail-Indikatoren
  if (authResults.spf && authResults.spf !== 'pass' && authResults.spf !== 'none') {
    indicators.push({
      type:        'auth_spf_fail',
      description: `SPF-Prüfung fehlgeschlagen: ${authResults.spf}`,
      severity:    authResults.spf === 'fail' ? 'high' : 'medium',
    });
  }
  if (authResults.dkim && authResults.dkim !== 'pass' && authResults.dkim !== 'none') {
    indicators.push({
      type:        'auth_dkim_fail',
      description: `DKIM-Prüfung fehlgeschlagen: ${authResults.dkim}`,
      severity:    authResults.dkim === 'fail' ? 'high' : 'medium',
    });
  }
  if (authResults.dmarc && authResults.dmarc !== 'pass' && authResults.dmarc !== 'none') {
    indicators.push({
      type:        'auth_dmarc_fail',
      description: `DMARC-Prüfung fehlgeschlagen: ${authResults.dmarc}`,
      severity:    'high',
    });
  }

  // ── IOC-Liste (konsolidiert, Typ-Namen konsistent mit Projekt) ────────────
  const iocs = [];

  // IPs
  for (const ip of ips) {
    iocs.push({ type: 'ip', value: ip });
  }
  // URLs
  for (const url of rawUrls) {
    iocs.push({ type: 'url', value: url });
  }
  // Domains (die noch nicht als URL-Host erfasst wurden)
  const urlHostSet2 = new Set(urlHosts);
  for (const d of domains) {
    if (!urlHostSet2.has(d)) {
      iocs.push({ type: 'domain', value: d });
    }
  }
  // Hashes aus Anhängen
  for (const att of attachments) {
    if (att.hash) {
      const hl = att.hash.toLowerCase();
      const hashType = hl.length === 128 ? 'sha512'
        : hl.length === 64 ? 'sha256'
        : hl.length === 40 ? 'sha1'
        : 'md5';
      iocs.push({ type: 'hash', hashType, value: hl, source: 'attachment', attachmentName: att.name });
    }
  }
  // Hashes aus Body
  for (const h of hashes) {
    iocs.push(h);
  }
  // E-Mails aus Body
  for (const e of bodyEmails) {
    iocs.push({ type: 'email', value: e.toLowerCase() });
  }
  // Sender/ReplyTo als IOC
  if (sender?.address) {
    iocs.push({ type: 'email', value: sender.address.toLowerCase(), role: 'sender' });
  }
  if (replyTo?.address && replyTo.address !== sender?.address) {
    iocs.push({ type: 'email', value: replyTo.address.toLowerCase(), role: 'reply_to' });
  }

  // Deduplizierung
  const seen   = new Set();
  const deduped = [];
  for (const ioc of iocs) {
    const key = `${ioc.type}:${ioc.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(ioc);
    }
  }

  return {
    sender,
    replyTo,
    returnPath,
    authResults,
    urls:       rawUrls,
    attachments,
    indicators,
    iocs:       deduped.slice(0, MAX_ITEMS * 3),
    parseError: false,
  };
}

module.exports = { parsePhishingEmail };
