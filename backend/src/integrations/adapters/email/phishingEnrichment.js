'use strict';

const phishingParser = require('./phishingParser');
const logger = require('../../../logger');

/**
 * phishingEnrichment.js — Brücke zwischen reinem phishingParser und Ticket-Draft.
 *
 * Verdrahtet `parsePhishingEmail` in den E-Mail→Ticket-Pfad: aus der Roh-Mail
 * extrahierte IOCs (URLs/Domains/IPs/Hashes/E-Mails) und Phishing-Indikatoren
 * (Spoofing, Auth-Fail, gefährliche Anhänge, URL-Shortener, Punycode) werden in
 * die bestehenden Ticket-Felder `iocs` (String) und `description` gemergt — dem
 * vorhandenen Ticket-Schema folgend, ohne neue Felder zu erfinden.
 *
 * Fail-safe: Ein Parser-Fehler darf das Ticket nicht verschlucken — bei Fehler
 * wird gewarnt und ein Null-Patch (keine Änderung) zurückgegeben.
 *
 * @param {object} rawEmail — die Roh-Mail (normalizedData.raw).
 * @param {{ description?: string, iocs?: string }} base — bestehende Draft-Felder.
 * @returns {{ description: string, iocs: string, phishingIndicatorCount: number }}
 */
function enrichDraftWithPhishing(rawEmail, base = {}) {
  const baseDescription = String(base.description || '');
  const baseIocs        = String(base.iocs || '');

  let parsed;
  try {
    parsed = phishingParser.parsePhishingEmail(rawEmail);
  } catch (err) {
    // Pures Modul wirft normalerweise nicht (es kapselt intern), aber falls doch:
    // kein still verschluckter Fehler — warnen und Ticket unverändert lassen.
    logger.warn('phishing_enrichment_failed', { message: err && err.message ? err.message : 'unknown' });
    return { description: baseDescription, iocs: baseIocs, phishingIndicatorCount: 0 };
  }

  if (!parsed || parsed.parseError) {
    if (parsed && parsed.parseErrorMessage) {
      logger.warn('phishing_enrichment_parse_error', { message: parsed.parseErrorMessage });
    }
    return { description: baseDescription, iocs: baseIocs, phishingIndicatorCount: 0 };
  }

  const iocLines        = formatIocs(parsed.iocs);
  const indicatorLines  = formatIndicators(parsed.indicators);

  const description = appendSection(
    baseDescription,
    'Phishing-Triage (automatisch)',
    indicatorLines,
  );
  const iocs = mergeIocs(baseIocs, iocLines);

  return {
    description,
    iocs,
    phishingIndicatorCount: (parsed.indicators || []).length,
  };
}

/** IOC-Objekte → Zeilen-Strings ("typ: wert"), dedupliziert. */
function formatIocs(iocs) {
  const seen  = new Set();
  const lines = [];
  for (const ioc of (iocs || [])) {
    if (!ioc || !ioc.value) continue;
    const label = ioc.hashType ? `${ioc.type}(${ioc.hashType})` : ioc.type;
    const line  = `${label}: ${ioc.value}`;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  }
  return lines;
}

/** Indikator-Objekte → lesbare Zeilen mit Severity. */
function formatIndicators(indicators) {
  return (indicators || []).map((ind) => {
    const sev = ind.severity ? `[${ind.severity}] ` : '';
    return `- ${sev}${ind.type}: ${ind.description || ''}`.trim();
  });
}

/** Bestehende iocs-String-Liste um neue Zeilen ergänzen (dedupliziert). */
function mergeIocs(baseIocs, newLines) {
  if (!newLines.length) return baseIocs;
  const existing = new Set(
    baseIocs.split('\n').map((l) => l.trim()).filter(Boolean),
  );
  const additions = newLines.filter((l) => !existing.has(l.trim()));
  if (!additions.length) return baseIocs;
  return [baseIocs, ...additions].filter(Boolean).join('\n');
}

/** Einen benannten Abschnitt an eine Beschreibung anhängen (nur wenn Zeilen da sind). */
function appendSection(baseDescription, heading, lines) {
  if (!lines.length) return baseDescription;
  const block = [`${heading}:`, ...lines].join('\n');
  return [baseDescription, block].filter(Boolean).join('\n\n');
}

module.exports = { enrichDraftWithPhishing };
