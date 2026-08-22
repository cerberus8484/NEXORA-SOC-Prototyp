'use strict';

// Sicherheits-Härtung (Info-Disclosure): Verbindungstests (/connection/test) dürfen
// keine rohen Fehler-Strings an den Client spiegeln — err.message trägt sonst interne
// Netzwerk-Topologie (ECONNREFUSED <IP:Port>, DNS-/TLS-Details) oder fremde
// Server-Texte (OTRS ErrorMessage) nach außen. `classifyConnError` mappt einen
// beliebigen Fehler auf eine feste, whitelistete deutsche Kategorie-Meldung. Der rohe
// err.message bleibt nur serverseitig (Log) — nie in der HTTP-Antwort.
//
// Bewusst kalibriert: der HTTP-Status (z.B. 500) ist keine Topologie und diagnostisch
// nützlich → er darf in der generischen Kategorie erscheinen; IPs/Ports/Zertifikats-
// Interna/Fremd-Texte NICHT.

/** @returns {string} eine sichere, für den Admin verständliche Fehlermeldung. */
function classifyConnError(err) {
  const status = err && typeof err.status === 'number' ? err.status : null;
  const code   = err && typeof err.code === 'string' ? err.code.toUpperCase() : '';
  const msg    = err && typeof err.message === 'string' ? err.message : '';

  // Auth zuerst — der häufigste, klar benennbare Fall. Auch aus der Message erkennen,
  // wenn der Fehler den Status nicht als Property trägt (gewrappte/gemockte Fehler).
  // Nur das explizite "HTTP <nnn>"-Muster parsen — NIE eine nackte Zahl (sonst würde
  // z.B. ein Port `:443` als HTTP-Status fehlgedeutet).
  const httpStatusInMsg = (() => { const m = msg.match(/\bHTTP\s+(\d{3})\b/i); return m ? Number(m[1]) : null; })();
  const effStatus = status ?? httpStatusInMsg;
  if (effStatus === 401 || effStatus === 403 || effStatus === 407 || /\bunauthorized\b|\bforbidden\b/i.test(msg)) {
    return 'Authentifizierung fehlgeschlagen — Zugangsdaten prüfen.';
  }
  // TLS-/Zertifikatsfehler (node/openssl-Codes) — nie das Zertifikat-Detail zeigen.
  if (/CERT|SSL|_TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ALT_NAME|WRONG_VERSION/.test(code)) {
    return 'TLS-/Zertifikatsfehler — Zertifikat oder TLS-Konfiguration prüfen.';
  }
  // DNS.
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Host nicht auflösbar (DNS).';
  }
  // Timeout.
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(msg)) {
    return 'Zeitüberschreitung beim Verbindungsversuch.';
  }
  // Nicht erreichbar / abgelehnt.
  if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE'].includes(code)) {
    return 'Verbindung abgelehnt oder Host nicht erreichbar.';
  }
  // Redirect blockiert (RealHttpClient: redirect:'error' als SSRF-Härtung).
  if (/redirect/i.test(msg)) {
    return 'Server-Redirect blockiert (Sicherheitsrichtlinie).';
  }
  // Sonstiger HTTP-Fehlerstatus — Status ist ok zu zeigen (keine Topologie).
  if (effStatus && effStatus >= 400) {
    return `Server antwortete mit einem Fehler (HTTP ${effStatus}).`;
  }
  // Fallback — nie den rohen err.message.
  return 'Verbindungstest fehlgeschlagen.';
}

module.exports = { classifyConnError };
