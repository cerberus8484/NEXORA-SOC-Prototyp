'use strict';

/**
 * QRadar Mapper — Offense-Felder → internes Domain-Format.
 *
 * QRadar nutzt Severity (1–10), Credibility (0–10) und Relevance (0–10).
 * Magnitude = berechneter Composite-Score.
 *
 * Mapping-Entscheidungen:
 * - Severity ist der primäre Treiber für Priority
 * - Credibility und Relevance modifizieren leicht nach oben
 * - Explizite Schwellen statt magischer Formeln (testbar + nachvollziehbar)
 */

/**
 * QRadar Severity 1–10 → unsere Priority
 * Referenz: QRadar "Severity" bedeutet technische Schwere des Angriffs.
 */
function mapSeverityToPriority(severity, credibility, relevance) {
  const sev  = Number(severity)    || 5;
  const cred = Number(credibility) || 5;
  const rel  = Number(relevance)   || 5;

  // Kombinations-Score: Severity hat 60% Gewicht, Credibility 20%, Relevance 20%
  const score = (sev * 0.6) + (cred * 0.2) + (rel * 0.2);

  if (score >= 8.5) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 5.0) return 'medium';
  if (score >= 3.0) return 'low';
  return 'info';
}

/**
 * Unix-Timestamp (ms) → ISO 8601 String
 */
function mapTimestamp(unixMs) {
  if (!unixMs) return '';
  return new Date(Number(unixMs)).toISOString();
}

/**
 * QRadar Status → interner Status
 */
function mapStatus(qradarStatus) {
  const map = {
    OPEN:   'open',
    CLOSED: 'closed',
    HIDDEN: 'fp',
  };
  return map[qradarStatus] || 'open';
}

/**
 * Offense-Titel aus description oder offense_name extrahieren
 */
function extractTitle(payload) {
  const base = payload.description || payload.offense_name || `QRadar Offense #${payload.id}`;
  return base.trim().slice(0, 200);
}

/**
 * Kategorien als kommagetrennte Liste
 */
function extractCategory(payload) {
  if (payload.categories?.length) {
    return payload.categories.slice(0, 5).join(', ').slice(0, 200);
  }
  return '';
}

/**
 * IPs aus aufgelösten Feldern oder ID-Listen
 */
function extractIPs(payload) {
  const srcIps = payload.source_ips?.length
    ? payload.source_ips
    : [];
  const dstIps = payload.dest_ips?.length
    ? payload.dest_ips
    : [];

  return {
    srcIp: srcIps[0] || '',
    dstIp: dstIps[0] || '',
    allSrcIps: srcIps,
    allDstIps: dstIps,
  };
}

/**
 * Vollständiges Mapping: QRadar Offense → normalisiertes IntegrationEvent-Format
 */
function mapOffenseToNormalized(payload, source = 'qradar', options = {}) {
  const ips = extractIPs(payload);

  return {
    // Identifikation
    source,
    externalId: `qradar:offense:${payload.id}`,
    title:      extractTitle(payload),
    category:   extractCategory(payload),

    // Status + Priorität
    priority:   mapSeverityToPriority(payload.severity, payload.credibility, payload.relevance),
    status:     mapStatus(payload.status),

    // Zeitstempel
    datetime:   mapTimestamp(payload.start_time || payload.last_updated_time),

    // Netzwerk-Entitäten
    srcIp:      ips.srcIp,
    dstIp:      ips.dstIp,

    // Beschreibung (für Analyse-Feld)
    description: [
      `QRadar Offense #${payload.id}`,
      payload.description ? `Beschreibung: ${payload.description}` : '',
      payload.severity    ? `Severity: ${payload.severity}/10` : '',
      payload.magnitude   ? `Magnitude: ${payload.magnitude}/10` : '',
      ips.allSrcIps.length > 1 ? `Alle Source IPs: ${ips.allSrcIps.join(', ')}` : '',
      ips.allDstIps.length > 1 ? `Alle Dest IPs: ${ips.allDstIps.join(', ')}` : '',
    ].filter(Boolean).join('\n'),

    // Evidence: Rohdaten erhalten (Traceability!)
    evidence: [{
      type:      'qradar_offense',
      label:     `QRadar Offense #${payload.id}`,
      source:    'qradar',
      raw:       payload,
    }],

    // Externer Link (optional — baseUrl wird vom Adapter übergeben, kein process.env hier)
    externalLinks: buildExternalLinks(payload, options.baseUrl || ''),

    // Alle Original-Felder für spätere Nutzung
    raw: payload,
  };
}

/**
 * Vollständiges Mapping: QRadar Event ODER Flow (roher flacher Record) →
 * normalisiertes IntegrationEvent-Format inkl. aufgegliedertem entities-Block.
 *
 * Quellunabhängig: nutzt den Record-Parser zur Typ-Erkennung + Feld-Aufgliederung
 * und den Entity-Extractor für die Entitäten. Raw bleibt als Evidence erhalten.
 */
function mapRecordToNormalized(rec, source = 'qradar', options = {}) {
  // Late require — vermeidet Zyklus (Parser importiert mapTimestamp aus dieser Datei).
  const { parseQRadarRecord } = require('./qradarRecordParser');
  const { extractRecordEntities } = require('./qradarEntityExtractor');

  const parsed   = parseQRadarRecord(rec, { type: options.type });
  const entities = extractRecordEntities(parsed);
  const net      = parsed.network;
  const isFlow   = parsed.type === 'flow';

  const externalId = isFlow
    ? `qradar:flow:${net.srcIp}:${net.srcPort ?? ''}-${net.dstIp}:${net.dstPort ?? ''}@${parsed.time.start}`
    : `qradar:event:${parsed.recordId || 'unknown'}@${parsed.time.start}`;

  const title = buildRecordTitle(parsed);

  return {
    source,
    externalId,
    title,
    category:   parsed.category.name || '',
    priority:   mapSeverityToPriority(parsed.severity, parsed.credibility, parsed.relevance),
    status:     'open',
    datetime:   parsed.time.start,

    srcIp:      net.srcIp,
    dstIp:      net.dstIp,

    description: buildRecordDescription(parsed),

    // Aufgegliederte Entitäten (auch für Flows)
    entities,

    evidence: [{
      type:   isFlow ? 'qradar_flow' : 'qradar_event',
      label:  title,
      source: 'qradar',
      raw:    rec,
    }],

    raw: rec,
  };
}

function buildRecordTitle(parsed) {
  const net = parsed.network;
  if (parsed.type === 'flow') {
    const app   = net.application || 'Flow';
    const tuple = `${net.srcIp || '?'}:${net.srcPort ?? '?'} → ${net.dstIp || '?'}:${net.dstPort ?? '?'}`;
    return `QRadar Flow ${app} ${tuple}`.trim().slice(0, 200);
  }
  const base = parsed.name || `QRadar Event QID ${parsed.recordId || '?'}`;
  return base.trim().slice(0, 200);
}

function buildRecordDescription(parsed) {
  const net = parsed.network;
  const lines = parsed.type === 'flow'
    ? [
        `QRadar Flow (${net.direction || 'n/a'})`,
        `${net.srcIp}:${net.srcPort ?? '?'} → ${net.dstIp}:${net.dstPort ?? '?'} ${net.protocol || ''}`.trim(),
        net.application ? `Application: ${net.application}` : '',
        net.bytes ? `Bytes: src ${net.bytes.src ?? 0} / dst ${net.bytes.dst ?? 0}` : '',
        net.flowSource ? `Flow-Source: ${net.flowSource}` : '',
      ]
    : [
        parsed.name ? `Event: ${parsed.name}` : 'QRadar Event',
        parsed.category.name ? `Kategorie: ${parsed.category.name}` : '',
        parsed.logSource.name ? `Log-Source: ${parsed.logSource.name}` : '',
        net.srcIp ? `Source: ${net.srcIp}:${net.srcPort ?? '?'}` : '',
        net.dstIp ? `Destination: ${net.dstIp}:${net.dstPort ?? '?'}` : '',
        parsed.identity.user ? `User: ${parsed.identity.user}` : '',
        parsed.eventCount ? `Event-Count: ${parsed.eventCount}` : '',
        parsed.severity != null ? `Severity: ${parsed.severity}/10` : '',
        parsed.payload ? `Payload: ${String(parsed.payload).slice(0, 300)}` : '',
      ];
  return lines.filter(Boolean).join('\n');
}

// baseUrl als Parameter — kein process.env hier, Mapper bleibt rein und testbar
function buildExternalLinks(payload, baseUrl = '') {
  if (!baseUrl) return [];

  return [{
    externalSystem: 'qradar',
    externalId:     String(payload.id),
    externalUrl:    `${baseUrl.replace(/\/$/, '')}/console/do/sem/offensesummary?summaryId=${payload.id}`,
    syncDirection:  'inbound',
  }];
}

module.exports = {
  mapSeverityToPriority,
  mapTimestamp,
  mapStatus,
  extractTitle,
  extractCategory,
  extractIPs,
  mapOffenseToNormalized,
  mapRecordToNormalized,
  buildRecordTitle,
  buildRecordDescription,
};
