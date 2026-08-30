'use strict';

// ─────────────────────────────────────────────────────────────────────────
// SIEM/Detection-Collector — Cowrie-Honeypot (cowrie.json, ein Objekt je Zeile).
// domain "siem", vendor "cowrie". Liefert die Detektion (eventid → Severity/MITRE)
// + Netzwerk-Kontext (Angreifer → Honeypot) + Entities.
//
// Zweck im Cross-Domain: Cowrie sieht DIESELBEN Angreifer-IPs wie der conntrack-Flow.
// Die Fusion hebt damit das Verdikt von `observed` (Flow allein) auf `suspicious`
// (Detection-Severity ≥ medium). `confirmed_malicious` bräuchte zusätzlich IDS/Block.
//
// dstIp wird bewusst auf die bekannte `honeypotIp` verankert, damit das IP-Paar
// exakt dem conntrack-Flow entspricht (Cowries dst_ip ist hinter Port-Redirect unzuverlässig).
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

const MAX_ACTIVITY_VALUE = 2000; // untrusted Honeypot-Input längen-cappen

function clean(v) { return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : null; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function toIso(ts) { if (!ts) return undefined; const d = new Date(ts); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
function capValue(v) { const s = clean(v); return s === null ? null : s.slice(0, MAX_ACTIVITY_VALUE); }

// Sitzungs-Aktivität je eventid → { kind, value?, user? }. Trägt den Befehl/Login/Download
// bis ins Ticket, damit die Payload-View nicht leer bleibt. Datensparsamkeit (DSGVO/ADR-009):
// KEIN Passwort ins Envelope — Login liefert nur den Benutzernamen. Werte längen-gecappt.
// Rückgabe null, wenn keine verwertbare Aktivität vorhanden ist (kein leeres Feld).
function extractActivity(o) {
  switch (o.eventid) {
    case 'cowrie.command.input': {
      const value = capValue(o.input);
      return value === null ? null : { kind: 'command', value };
    }
    case 'cowrie.login.failed':
    case 'cowrie.login.success': {
      const user = capValue(o.username);
      return { kind: 'login', ...(user === null ? {} : { user }) };
    }
    case 'cowrie.session.file_download': {
      const value = capValue(o.url) ?? capValue(o.outfile);
      return value === null ? null : { kind: 'download', value };
    }
    case 'cowrie.direct-tcpip.request': {
      const dst = clean(o.dst_ip);
      const port = toNum(o.dst_port);
      if (dst === null) return null;
      const value = capValue(port !== null ? `${dst}:${port}` : dst);
      return { kind: 'tunnel', value };
    }
    default:
      return null;
  }
}

// eventid → Detektions-Bewertung. Nur detektions-würdige Events; alles andere = Rauschen (null).
const COWRIE_EVENT_MAP = {
  'cowrie.login.failed':        { severity: 'medium', signature: 'Cowrie: SSH-Brute-Force-Login-Versuch', mitre: ['T1110'] },
  'cowrie.login.success':       { severity: 'high',   signature: 'Cowrie: SSH-Login erfolgreich (Honeypot-Kompromittierung)', mitre: ['T1078', 'T1110'] },
  'cowrie.command.input':       { severity: 'high',   signature: 'Cowrie: Befehl in Honeypot-Session ausgeführt', mitre: ['T1059'] },
  'cowrie.session.file_download': { severity: 'high', signature: 'Cowrie: Datei-Download in Honeypot-Session', mitre: ['T1105'] },
  'cowrie.direct-tcpip.request':{ severity: 'high',   signature: 'Cowrie: TCP-Tunneling-Versuch über Honeypot', mitre: ['T1090'] },
};

/**
 * @param {{ instanceId:string, honeypotIp:string, parserVersion?:string }} opts
 */
function createCowrieCollector({ instanceId, honeypotIp, parserVersion = '0.1.0' } = {}) {
  if (!instanceId) throw new Error('cowrieCollector: instanceId required');
  if (!honeypotIp) throw new Error('cowrieCollector: honeypotIp required (Pairing-Anker für die Fusion)');

  return {
    name: `siem-cowrie-${instanceId}`,
    domain: 'siem',
    source: { type: 'siem', vendor: 'cowrie', instanceId },
    parserVersion,
    normalize(line) {
      let o;
      try { o = typeof line === 'string' ? JSON.parse(line) : line; } catch { return null; }
      if (!o || typeof o !== 'object') return null;
      const det = COWRIE_EVENT_MAP[o.eventid];
      if (!det) return null;                       // nicht detektions-würdig → Rauschen
      const srcIp = clean(o.src_ip);
      if (!srcIp) return null;                      // ohne Angreifer-IP nicht fusionierbar

      const sensor = clean(o.sensor);
      const entities = [
        { type: 'ip', value: srcIp, role: 'source' },
        { type: 'ip', value: honeypotIp, role: 'destination' },
      ];
      if (sensor) entities.push({ type: 'host', value: sensor, role: 'sensor' });

      const activity = extractActivity(o);

      return {
        observedAt: toIso(o.timestamp),
        rawHash: crypto.createHash('sha256').update(typeof line === 'string' ? line : JSON.stringify(o)).digest('hex'),
        rawRef: `cowrie:${clean(o.session) || 'session'}:${o.eventid}`,
        entities,
        detection: {
          ruleId: o.eventid,
          severity: det.severity,
          signature: det.signature,
          mitre: det.mitre,
        },
        network: {
          srcIp,
          dstIp: honeypotIp,
          srcPort: toNum(o.src_port),
          dstPort: toNum(o.dst_port) || 2222,
          protocol: 'tcp',
        },
        ...(activity ? { activity } : {}),
        confidence: 1,
      };
    },
  };
}

module.exports = { createCowrieCollector, COWRIE_EVENT_MAP };
