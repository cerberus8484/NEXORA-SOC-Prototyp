'use strict';

/**
 * Wazuh Mapper — Alert-Felder → internes Domain-Format.
 *
 * Wazuh Rule Level 0–15:
 *   0–3   → info      (Systemmeldungen, keine Bedrohung)
 *   4–7   → medium    (Fehlgeschlagene Anmeldungen, Policy-Verstöße)
 *   8–11  → high      (Multiple Fehler, System-Eingriffe)
 *   12–15 → critical  (Angriffe, Rootkit-Aktivität)
 *
 * Referenz: https://documentation.wazuh.com/current/user-manual/ruleset/rules-classification.html
 */

const { extractNetworkSourceIp, extractHoneypotAttackerIp, extractSensorIp } = require('../../../correlation/networkSourceIp');

function mapLevelToPriority(level) {
  const l = Number(level) || 0;
  if (l >= 12) return 'critical';
  if (l >= 8)  return 'high';
  if (l >= 4)  return 'medium';
  if (l >= 1)  return 'low';
  return 'info';
}

/**
 * ISO 8601 oder Unix-ms → ISO 8601 String
 */
function mapTimestamp(ts) {
  if (!ts) return '';
  if (typeof ts === 'number') return new Date(ts).toISOString();
  // Bereits ISO — normalisieren (ungültig → leer)
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function extractTitle(payload) {
  const desc   = payload.rule?.description || '';
  const ruleId = payload.rule?.id ? `Rule ${payload.rule.id}` : '';
  const base   = desc || ruleId || `Wazuh Alert ${payload.id || ''}`;
  return base.trim().slice(0, 200);
}

function extractCategory(payload) {
  const groups = payload.rule?.groups || [];
  if (groups.length) return groups.slice(0, 5).join(', ').slice(0, 200);
  return '';
}

function extractIPs(payload) {
  const data = payload.data || {};
  // Saubere Rollen-Trennung (Slice 2b.0):
  //  srcIp      = echte Netzwerkquelle (Cowrie/Firewall/Sysmon) — NIE agent.ip
  //  attackerIp = nur im Honeypot-Kontext (Cowrie src_ip)
  //  sensorIp   = „wer hat gemeldet" (agent.ip), reiner Host-/Sensor-Kontext
  return {
    srcIp:      extractNetworkSourceIp(payload) || '',
    dstIp:      data.dstip || '',
    sensorIp:   extractSensorIp(payload) || '',
    attackerIp: extractHoneypotAttackerIp(payload) || '',
  };
}

function extractMitre(payload) {
  const m = payload.rule?.mitre || {};
  return {
    techniqueIds: m.id        || [],
    tactics:      m.tactic    || [],
    techniques:   m.technique || [],
  };
}

function buildDescription(payload, ips, mitre) {
  const lines = [
    `Wazuh Alert — Rule ${payload.rule?.id} (Level ${payload.rule?.level})`,
    payload.rule?.description ? `Beschreibung: ${payload.rule.description}` : '',
    payload.agent?.name       ? `Agent: ${payload.agent.name} (${payload.agent.ip || 'IP unbekannt'})` : '',
    ips.srcIp                 ? `Source IP: ${ips.srcIp}` : '',
    ips.dstIp                 ? `Dest IP: ${ips.dstIp}` : '',
    payload.location          ? `Log-Quelle: ${payload.location}` : '',
    mitre.techniqueIds.length ? `MITRE ATT&CK: ${mitre.techniqueIds.join(', ')}` : '',
    mitre.tactics.length      ? `Taktik: ${mitre.tactics.join(', ')}` : '',
    payload.full_log          ? `Full Log: ${payload.full_log.slice(0, 500)}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Vollständiges Mapping: Wazuh Alert → normalisiertes IntegrationEvent-Format
 */
function mapAlertToNormalized(payload, source = 'wazuh') {
  const ips   = extractIPs(payload);
  const mitre = extractMitre(payload);

  // externalId = Offense-Identität (Regel + Agent), NICHT die einzelne Alert-ID.
  // So landen wiederkehrende Alerts derselben Regel auf demselben Agent in EINEM
  // Ticket (Dedup), statt pro Alert ein neues Ticket zu erzeugen.
  const agentKey = payload.agent?.id || payload.agent?.name || 'unknown';

  return {
    source,
    externalId: `wazuh:rule:${payload.rule?.id}:agent:${agentKey}`,
    title:      extractTitle(payload),
    category:   extractCategory(payload),

    priority:   mapLevelToPriority(payload.rule?.level),
    status:     'open',

    datetime:   mapTimestamp(payload.timestamp),

    srcIp:      ips.srcIp,
    dstIp:      ips.dstIp,
    sensorIp:   ips.sensorIp,
    attackerIp: ips.attackerIp,

    description: buildDescription(payload, ips, mitre),

    // MITRE-Felder als strukturierte Metadaten — für spätere Hunt-Verknüpfung
    mitre,

    evidence: [{
      type:   'wazuh_alert',
      label:  `Wazuh Rule ${payload.rule?.id} — Level ${payload.rule?.level}`,
      source: 'wazuh',
      raw:    payload,
    }],

    raw: payload,
  };
}

module.exports = {
  mapLevelToPriority,
  mapTimestamp,
  extractTitle,
  extractCategory,
  extractIPs,
  extractMitre,
  mapAlertToNormalized,
};
