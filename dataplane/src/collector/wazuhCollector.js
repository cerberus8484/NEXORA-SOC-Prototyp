'use strict';

// ─────────────────────────────────────────────────────────────────────────
// SIEM-Collector — Wazuh-Alert-JSON (alerts.json, ein Objekt je Zeile).
// domain "siem", vendor "wazuh". Liefert die Detektion (Rule/Level/Severity/MITRE)
// + ggf. Netzwerk-Kontext + Entities (Angreifer/Ziel/meldender Agent).
//
// Severity-Bänder = Wazuh Rule Level 0–15 (s. wazuhMapper.js):
//   0–3 info · 4–7 medium · 8–11 high · 12–15 critical
// minLevel filtert Rauschen (Default 0 = alles).
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

function clean(v) { return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : null; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function toIso(ts) { if (!ts) return undefined; const d = new Date(ts); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }

function mapLevelToSeverity(level) {
  const l = Number(level) || 0;
  if (l >= 12) return 'critical';
  if (l >= 8) return 'high';
  if (l >= 4) return 'medium';
  return 'info';
}

/**
 * @param {{ instanceId:string, minLevel?:number, parserVersion?:string }} opts
 */
function createWazuhCollector({ instanceId, minLevel = 0, parserVersion = '0.1.0' } = {}) {
  if (!instanceId) throw new Error('wazuhCollector: instanceId required');

  return {
    name: `siem-wazuh-${instanceId}`,
    domain: 'siem',
    source: { type: 'siem', vendor: 'wazuh', instanceId },
    parserVersion,
    normalize(line) {
      let a;
      try { a = typeof line === 'string' ? JSON.parse(line) : line; } catch { return null; }
      if (!a || typeof a !== 'object' || !a.rule || typeof a.rule !== 'object') return null; // kein Alert
      const level = Number(a.rule.level) || 0;
      if (level < minLevel) return null; // Rausch-Gate

      const data = (a.data && typeof a.data === 'object') ? a.data : {};
      const srcIp = clean(data.srcip || data.src_ip);
      const dstIp = clean(data.dstip || data.dst_ip);
      const agentName = clean(a.agent && a.agent.name);
      const agentIp = clean(a.agent && a.agent.ip);

      const entities = [];
      if (srcIp) entities.push({ type: 'ip', value: srcIp, role: 'source' });
      if (dstIp && dstIp !== srcIp) entities.push({ type: 'ip', value: dstIp, role: 'destination' });
      if (agentName) entities.push({ type: 'host', value: agentName, role: 'sensor' });

      const mitre = a.rule.mitre && Array.isArray(a.rule.mitre.id) ? a.rule.mitre.id : undefined;
      const part = {
        observedAt: toIso(a.timestamp || a['@timestamp']),
        rawHash: crypto.createHash('sha256').update(typeof line === 'string' ? line : JSON.stringify(a)).digest('hex'),
        rawRef: `wazuh:alert:${clean(a.id) || a.rule.id}`,
        entities,
        detection: {
          ruleId: clean(a.rule.id),
          level,
          severity: mapLevelToSeverity(level),
          signature: clean(a.rule.description),
          groups: Array.isArray(a.rule.groups) ? a.rule.groups.slice(0, 10) : undefined,
          mitre,
        },
        confidence: 1,
      };

      // network nur wenn echte IPs vorliegen (keine Pseudo-Felder; agent.ip ≠ Netzwerkquelle).
      if (srcIp || dstIp) {
        part.network = {
          srcIp: srcIp || null, dstIp: dstIp || null,
          srcPort: toNum(data.srcport || data.src_port),
          dstPort: toNum(data.dstport || data.dst_port),
          protocol: clean(data.protocol) ? String(data.protocol).toLowerCase() : null,
        };
      }
      if (agentIp) part.agent = { name: agentName, ip: agentIp };
      return part;
    },
  };
}

module.exports = { createWazuhCollector, mapLevelToSeverity };
