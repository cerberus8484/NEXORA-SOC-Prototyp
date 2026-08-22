'use strict';

/**
 * E-Mail Mapper — Mail-Felder → internes Domain-Format.
 *
 * E-Mails haben keine strukturierte Severity wie ein SIEM. Wir leiten die
 * Priority heuristisch aus Subject + Body ab (Keyword-Matching). Bewusst
 * explizite, testbare Schwellen statt einer Black-Box.
 *
 * Datenschutz: Der Mapper extrahiert nur einen kurzen Body-Auszug für die
 * Beschreibung. Der vollständige Body landet ausschließlich in der Evidence
 * (Traceability) und wird NICHT geloggt.
 */

// Keyword → Priority. Höchste gefundene Stufe gewinnt.
const PRIORITY_KEYWORDS = {
  critical: ['critical', 'breach', 'ransomware', 'compromise', 'compromised', 'data exfiltration', 'p1', 'sev1'],
  high:     ['urgent', 'failed', 'failure', 'attack', 'malware', 'phishing', 'intrusion', 'alert', 'high', 'p2', 'sev2'],
  medium:   ['warning', 'suspicious', 'anomaly', 'detected', 'medium', 'p3'],
  low:      ['info', 'informational', 'notice', 'low', 'p4'],
};

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

const BODY_EXCERPT_LEN = 500;
const TITLE_MAX_LEN     = 200;

// Simple, bewusst konservative IOC-Regex (keine vollständige RFC-Abdeckung).
const IPV4_RE   = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;

/**
 * Body-Text ermitteln (body bevorzugt, sonst text).
 */
function resolveBody(payload) {
  return (payload.body || payload.text || '').toString();
}

/**
 * Subject + Body → Priority via Keyword-Heuristik.
 * Default medium (eingehende Alert-Mail ohne Keyword ist nicht "info").
 */
function mapPriority(payload) {
  const haystack = `${payload.subject || ''} ${resolveBody(payload)}`.toLowerCase();

  for (const level of PRIORITY_ORDER) {
    const hit = PRIORITY_KEYWORDS[level].some((kw) => haystack.includes(kw));
    if (hit) return level;
  }
  return 'medium';
}

/**
 * Titel aus Subject (Fallback: messageId / generisch).
 */
function extractTitle(payload) {
  const base = (payload.subject || '').trim()
    || (payload.messageId ? `E-Mail ${payload.messageId}` : 'Eingehende Alert-E-Mail');
  return base.slice(0, TITLE_MAX_LEN);
}

/**
 * Dedup-Schlüssel: messageId bevorzugt. Fehlt sie, deterministischer
 * Fallback aus from+subject (kein Crash, aber schwächere Dedup).
 */
function resolveMessageId(payload) {
  const mid = (payload.messageId || '').trim();
  if (mid) return mid;
  const fallback = `${(payload.from || '').trim()}|${(payload.subject || '').trim()}`;
  return fallback || 'unknown';
}

/**
 * IOCs (IPs, Domains) aus dem Body extrahieren — dedupliziert, gedeckelt.
 */
function extractIOCs(payload) {
  // Body zuerst, Subject danach durchsuchen — IOCs stehen in beiden (Betreff z.B.
  // "breach on host <ip>"). Body-first hält srcIp = erste Body-IP (i.d.R. der Angreifer).
  // Auf 10k Zeichen begrenzen — verhindert teure Regex-Läufe (ReDoS-Risiko) auf
  // bis zu 100k großen Bodies. IOCs stehen i.d.R. am Anfang/im Betreff.
  const haystack = `${resolveBody(payload)}\n${payload.subject || ''}`.slice(0, 10_000);

  const ips = [...new Set(haystack.match(IPV4_RE) || [])].slice(0, 20);

  // Domains: IPs rausfiltern (Regex überlappt), auf sinnvolle Anzahl deckeln.
  const ipSet = new Set(ips);
  const domains = [...new Set((haystack.match(DOMAIN_RE) || []).map((d) => d.toLowerCase()))]
    .filter((d) => !ipSet.has(d))
    .slice(0, 20);

  return { ips, domains };
}

/**
 * Zeitstempel parsen (ISO oder RFC 2822). Ungültig → leer.
 */
function mapTimestamp(payload) {
  const raw = payload.receivedAt || payload.date || '';
  if (!raw) return '';
  const ts = new Date(raw);
  return Number.isNaN(ts.getTime()) ? '' : ts.toISOString();
}

/**
 * Vollständiges Mapping: Mail → normalisiertes IntegrationEvent-Format.
 */
function mapEmailToNormalized(payload, source = 'email') {
  const messageId = resolveMessageId(payload);
  const iocs      = extractIOCs(payload);
  const body      = resolveBody(payload);
  const excerpt   = body.slice(0, BODY_EXCERPT_LEN);

  return {
    // Identifikation
    source,
    externalId: `email:msg:${messageId}`,
    title:      extractTitle(payload),
    category:   'email',

    // Priorität (Status: eingehende Alert-Mail ist offen)
    priority:   mapPriority(payload),
    status:     'open',

    // Zeitstempel
    datetime:   mapTimestamp(payload),

    // Netzwerk-Entitäten (erste extrahierte IP, falls vorhanden)
    srcIp:      iocs.ips[0] || '',
    dstIp:      '',

    // Beschreibung (Subject + kurzer Body-Auszug — KEIN voller Body)
    description: [
      `E-Mail von: ${payload.from || 'unbekannt'}`,
      payload.subject ? `Betreff: ${payload.subject}` : '',
      excerpt ? `Auszug:\n${excerpt}` : '',
      iocs.ips.length     ? `IPs: ${iocs.ips.join(', ')}` : '',
      iocs.domains.length ? `Domains: ${iocs.domains.join(', ')}` : '',
    ].filter(Boolean).join('\n'),

    // IOCs strukturiert (für spätere Anreicherung)
    iocs,

    // Evidence: Rohdaten erhalten (Traceability!) — voller Body NUR hier.
    evidence: [{
      type:   'email',
      label:  extractTitle(payload),
      source: 'email',
      raw:    payload,
    }],

    // Original-Felder
    raw: payload,
  };
}

module.exports = {
  PRIORITY_KEYWORDS,
  mapPriority,
  extractTitle,
  resolveMessageId,
  extractIOCs,
  mapTimestamp,
  mapEmailToNormalized,
};
