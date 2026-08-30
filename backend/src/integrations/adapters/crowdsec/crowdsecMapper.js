'use strict';

// Mappt ein CrowdSec-Alert (WAN-Detection vom Webserver) auf den normalisierten
// Nexora-Vertrag (gleiche Felder wie der Wazuh-Mapper). Rein + testbar, kein Netz.

// Szenario -> Kategorie / MITRE / Basis-Schwere. Erste passende Regel gewinnt.
const SCENARIO_RULES = [
  { re: /cve|exploit|log4j|backdoor|\brce\b/i,                            category: 'Exploitation',      mitre: { id: 'T1190', name: 'Exploit Public-Facing Application' }, severity: 'critical' },
  { re: /sqli|injection|path-traversal|\blfi\b|\bxss\b|sensitive-files/i, category: 'Web Attack',        mitre: { id: 'T1190', name: 'Exploit Public-Facing Application' }, severity: 'high' },
  { re: /bruteforce|brute|password|credential/i,                         category: 'Brute Force',       mitre: { id: 'T1110', name: 'Brute Force' },                       severity: 'high' },
  { re: /flood|slowloris|\bdos\b/i,                                       category: 'Denial of Service', mitre: { id: 'T1498', name: 'Network Denial of Service' },         severity: 'high' },
  { re: /probing|crawl|scan|bad-user-agent|enum|base-http/i,              category: 'Reconnaissance',    mitre: { id: 'T1595', name: 'Active Scanning' },                   severity: 'low' },
];

const DEFAULT_RULE = { category: 'Web Attack', mitre: null, severity: 'medium' };

function classify(scenario) {
  const s = String(scenario || '');
  return SCENARIO_RULES.find((r) => r.re.test(s)) || DEFAULT_RULE;
}

function firstDecision(alert) {
  return Array.isArray(alert.decisions) && alert.decisions.length ? alert.decisions[0] : null;
}

// Defensive Normalisierung externer Strings: Whitespace (inkl. Steuerzeichen wie
// Zeilenumbruch/Tab) auf ein Leerzeichen kollabieren und HTML-Klammern entfernen.
// Bindestriche/Slashes der Szenario-Namen bleiben erhalten.
function clean(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/[<>]/g, '');
}

function buildDescription(alert, rule, src) {
  const dec = firstDecision(alert);
  const asPart = src.as_number
    ? ` (AS${src.as_number}${src.as_name ? ' ' + src.as_name : ''}${src.cn ? ', ' + src.cn : ''})`
    : (src.cn ? ` (${src.cn})` : '');

  const lines = ['CrowdSec-Alert (Webserver / WAN)'];
  if (alert.message) lines.push(clean(alert.message));
  lines.push(`Szenario: ${clean(alert.scenario)}`);
  lines.push(`Quelle: ${clean(src.value)}${clean(asPart)}`);
  if (alert.events_count != null) lines.push(`Events: ${Number(alert.events_count)}`);
  lines.push(
    dec && dec.simulated !== true
      ? `Decision: ${clean(dec.type || 'ban')} ${clean(dec.duration || '')} (${clean(dec.origin || 'crowdsec')})`.trim()
      : 'Decision: keine aktive Sperre',
  );
  if (rule.mitre) lines.push(`MITRE: ${rule.mitre.id} ${rule.mitre.name}`);
  return lines.join('\n');
}

function mapAlertToNormalized(alert, source = 'crowdsec') {
  const src  = alert.source || {};
  const rule = classify(alert.scenario);
  const dec  = firstDecision(alert);
  const banned   = Boolean(dec && dec.simulated !== true);
  const priority = alert.simulated ? 'info' : rule.severity;
  const srcIp    = src.value || src.ip || '';
  const datetime = alert.start_at || alert.created_at || new Date().toISOString();

  return {
    externalId:  alert.id != null ? `crowdsec:alert:${alert.id}` : `crowdsec:${alert.scenario}:${srcIp}`,
    title:       `${rule.category} von ${srcIp}`,
    category:    rule.category,
    priority,
    datetime,
    srcIp,
    dstIp:       '',
    description: buildDescription(alert, rule, src),
    source,
    mitre:       rule.mitre,
    scenario:    alert.scenario,
    eventsCount: alert.events_count ?? null,
    banned,
    banDuration: banned ? (dec.duration || null) : null,
    asNumber:    src.as_number != null ? String(src.as_number) : '',
    asName:      src.as_name || '',
    country:     src.cn || '',
    simulated:   Boolean(alert.simulated),
    raw:         alert,
  };
}

module.exports = { mapAlertToNormalized, classify };
