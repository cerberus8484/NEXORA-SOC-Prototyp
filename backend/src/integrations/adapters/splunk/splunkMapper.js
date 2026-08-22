'use strict';

/**
 * Splunk Mapper — Alert/Notable-Felder → internes Domain-Format.
 *
 * Herausforderung: Splunk-Feldnamen sind inkonsistent.
 * src oder src_ip? user oder src_user? rule_name oder rule_title?
 * → Koalesze-Strategie: erste nicht-leere Variante gewinnt.
 */

const URGENCY_TO_PRIORITY = {
  critical:      'critical',
  high:          'high',
  medium:        'medium',
  low:           'low',
  informational: 'info',
};

function mapUrgencyToPriority(urgency) {
  return URGENCY_TO_PRIORITY[String(urgency).toLowerCase()] || 'medium';
}

/** Unix-Timestamp (Sekunden oder Millisekunden) → ISO 8601 */
function mapTimestamp(splunkTime) {
  if (!splunkTime) return '';
  const ts = Number(splunkTime);
  // Splunk liefert Sekunden (epoch), nicht Millisekunden
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toISOString();
}

/** Erste nicht-leere Variante aus mehreren Feldnamen */
function coalesce(...values) {
  return values.find(v => v && String(v).trim()) || '';
}

/** Notable-Titel aus rule_title, rule_name oder search_name */
function extractTitle(payload) {
  const r = payload.result || {};
  const title = coalesce(r.rule_title, r.rule_name, payload.search_name, `Splunk Alert (${payload.sid || 'unknown'})`);
  return String(title).trim().slice(0, 200);
}

/** Externe ID — event_id wenn vorhanden, sonst sid */
function extractExternalId(payload) {
  const r = payload.result || {};
  return coalesce(r.event_id, payload.sid) || `splunk:${Date.now()}`;
}

/** Source IP — src oder src_ip */
function extractSrcIp(r) { return coalesce(r.src, r.src_ip); }
/** Dest IP — dest oder dest_ip */
function extractDstIp(r)  { return coalesce(r.dest, r.dest_ip); }
/** User — user oder src_user */
function extractUser(r)   { return coalesce(r.user, r.src_user); }

/**
 * Vollständiges Mapping: Splunk Alert → normalisiertes IntegrationEvent-Format
 */
function mapAlertToNormalized(payload, source = 'splunk', options = {}) {
  const r = payload.result || {};

  const srcIp    = extractSrcIp(r);
  const dstIp    = extractDstIp(r);
  const user     = extractUser(r);
  const externalId = extractExternalId(payload);

  return {
    source,
    externalId: `splunk:alert:${externalId}`,
    title:    extractTitle(payload),
    category: coalesce(r.category, r.type, ''),

    priority: mapUrgencyToPriority(r.urgency),
    status:   'open',

    datetime: mapTimestamp(r._time),

    // Netzwerk
    srcIp,
    srcFqdn: coalesce(r.src_dns, ''),
    dstIp,
    dstFqdn: coalesce(r.dest_dns, ''),
    port:    r.dest_port ? String(r.dest_port) : '',
    protocol: coalesce(r.protocol, ''),

    // User
    user,

    // MITRE
    mitre: coalesce(r['mitre_technique_id'], ''),

    // Beschreibung
    description: [
      `Splunk Alert: ${extractTitle(payload)}`,
      r.urgency       ? `Urgency: ${r.urgency}` : '',
      r.description   ? `Details: ${r.description}` : '',
      r.message       ? `Message: ${r.message}`      : '',
      srcIp           ? `Source: ${srcIp}${coalesce(r.src_dns) ? ` (${r.src_dns})` : ''}` : '',
      dstIp           ? `Dest: ${dstIp}${coalesce(r.dest_dns) ? ` (${r.dest_dns})` : ''}` : '',
      user            ? `User: ${user}` : '',
      r['mitre_technique_id'] ? `MITRE: ${r['mitre_technique_id']}` : '',
    ].filter(Boolean).join('\n'),

    // Evidence: Rohdaten erhalten (Traceability!)
    evidence: [{
      type:   'splunk_alert',
      label:  `Splunk Alert: ${extractTitle(payload)}`,
      source: 'splunk',
      raw:    payload,
    }],

    // Externer Link (optional)
    externalLinks: buildExternalLinks(payload, externalId, options.baseUrl || ''),

    raw: payload,
  };
}

function buildExternalLinks(payload, externalId, baseUrl = '') {
  if (!baseUrl) return [];
  return [{
    externalSystem: 'splunk',
    externalId:     externalId,
    externalUrl:    `${baseUrl.replace(/\/$/, '')}/en-US/app/SplunkEnterpriseSecuritySuite/incident_review?search=event_id%3D${encodeURIComponent(externalId)}`,
    syncDirection:  'inbound',
  }];
}

module.exports = {
  mapUrgencyToPriority,
  mapTimestamp,
  coalesce,
  extractTitle,
  extractExternalId,
  extractSrcIp,
  extractDstIp,
  extractUser,
  mapAlertToNormalized,
};
