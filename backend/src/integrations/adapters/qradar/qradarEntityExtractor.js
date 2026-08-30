'use strict';

// ─────────────────────────────────────────────────────────────────────────
// QRadar Entity Extractor
//
// Nimmt einen geparsten QRadar-Record (siehe qradarRecordParser) und gliedert
// die beobachtbaren Objekte feldweise in Entitäten auf:
//   { kind, value, note, source }
//
// Kompatibel zum bestehenden correlation/entityCorrelation-Modell (gleiche
// kind-Werte ip/host/user/mac/domain/url/process/file/hash), erweitert um
// flow-spezifische Entitäten (port/application/asn). Das Ergebnis lässt sich
// direkt durch mergeEntities/correlateEntities quellenübergreifend mergen.
//
// Rein + pro Record dedupliziert (kind|value) → ein Treffer zählt einmal.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Geparsten Record → aufgegliederte Entitäten.
 * @param {object} parsed  Ergebnis von parseQRadarRecord()
 * @returns {Array<{kind:string,value:string,note?:string,source:string}>}
 */
function extractRecordEntities(parsed = {}) {
  const source = parsed.source || 'qradar';
  const seen = new Set();
  const out = [];

  const add = (kind, value, note) => {
    const v = (value === undefined || value === null ? '' : String(value)).trim();
    if (!v) return;
    const key = `${kind}|${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(note ? { kind, value: v, note, source } : { kind, value: v, source });
  };

  const net = parsed.network || {};
  const id  = parsed.identity || {};

  // IPs mit Rolle
  add('ip', net.srcIp, 'Source');
  add('ip', net.dstIp, 'Destination');
  add('ip', id.ip, 'Identity');

  // Ports mit Rolle
  add('port', net.srcPort, 'Source');
  add('port', net.dstPort, 'Destination');

  // MACs
  add('mac', net.srcMac, 'Source');
  add('mac', net.dstMac, 'Destination');
  add('mac', id.mac, 'Identity');

  // Identität
  add('user', id.user);
  add('host', id.host);

  // Namensobjekte
  add('domain', parsed.fqdn);
  add('url', parsed.url);
  add('process', parsed.process);
  add('process', parsed.parentProcess, 'Parent');
  add('file', parsed.file);
  add('hash', parsed.hash);

  // Flow-spezifisch
  if (parsed.type === 'flow') {
    add('application', net.application);
    // ASN 0 ist QRadars Sentinel für „unbekannt/privat" — keine echte Entität.
    if (net.asn) {
      if (net.asn.src) add('asn', net.asn.src, 'Source');
      if (net.asn.dst) add('asn', net.asn.dst, 'Destination');
    }
  }

  return out;
}

module.exports = { extractRecordEntities };
