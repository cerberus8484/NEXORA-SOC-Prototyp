'use strict';

/**
 * EvidenceBundleBuilder — P18.1 AI Evidence Bundle (Step 2)
 *
 * Nimmt Ticket + Evidence-Array (aus DB) und baut ein vollständiges
 * EvidenceBundle für den KI-Prompt.
 *
 * Ablauf:
 *  1. Sucht in evidence[] nach Einträgen mit type='wazuh_alert' → normalisiert den Raw-Alert
 *  2. Fallback: sucht in ticket.logs nach "Raw Alert (JSON):" Marker
 *  3. Leitet Observations ab (MITRE, Severity, Kontext-Flags)
 *  4. Sammelt fehlende Daten aus allen Quellen
 *  5. Gibt unveränderliches EvidenceBundle zurück
 */

const { normalize }      = require('./WazuhAlertNormalizer');
const { EvidenceBundle } = require('./EvidenceBundle');
const { loadConfigFromEnv, classifyIp } = require('./ownedAssets');

// ── Raw-Alert aus Evidence-Einträgen extrahieren ────────────────────────────

/**
 * @param {object[]} evidence
 * @returns {object|null}  Erstes gültiges Wazuh-Alert-JSON oder null
 */
function _extractAlertFromEvidence(evidence) {
  for (const e of evidence) {
    if (e.type !== 'wazuh_alert') continue;

    // value / rawValue kann JSON-String oder bereits geparst sein
    const candidate = e.value ?? e.rawValue ?? e.raw;
    if (!candidate) continue;

    if (typeof candidate === 'object') return candidate;

    try { return JSON.parse(candidate); } catch { /* weiter */ }
  }
  return null;
}

/**
 * Fallback: parst "Raw Alert (JSON):\n{...}" aus ticket.logs
 *
 * @param {object} ticket
 * @returns {object|null}
 */
function _extractAlertFromLogs(ticket) {
  const logs = ticket?.logs;
  if (!logs || typeof logs !== 'string') return null;

  const marker = 'Raw Alert (JSON):';
  const idx    = logs.indexOf(marker);
  if (idx === -1) return null;

  const jsonStr = logs.slice(idx + marker.length).trim();
  try { return JSON.parse(jsonStr); } catch { return null; }
}

// ── Observations aus normalisiertem Alert ableiten ──────────────────────────

/**
 * Leitet strukturierte Beobachtungen für den KI-Prompt ab.
 * Jede Observation hat: category, label, value (immer string)
 *
 * @param {object} alert  Normalisierter Alert
 * @returns {object[]}
 */
function _deriveObservations(alert) {
  if (!alert?.available) return [];
  const obs = [];

  const add = (category, label, value) => {
    if (value != null && String(value).trim()) {
      obs.push({ category, label, value: String(value).trim() });
    }
  };

  // Severity-Einordnung
  const level = alert.ruleLevel ?? 0;
  if (level >= 12)      add('severity', 'Kritisch',   `Regel-Level ${level} ≥ 12 (kritisch)`);
  else if (level >= 7)  add('severity', 'Hoch',       `Regel-Level ${level} ≥ 7 (hoch)`);
  else if (level >= 4)  add('severity', 'Mittel',     `Regel-Level ${level} ≥ 4 (mittel)`);
  else                  add('severity', 'Niedrig',    `Regel-Level ${level} < 4 (niedrig)`);

  // MITRE
  (alert.mitreTactics || []).forEach((t) => add('mitre', 'Tactic',    t));
  (alert.mitreTechniques || []).forEach((t) => add('mitre', 'Technique', t));

  // Threat Intel (VirusTotal) — stärkstes externes Signal, klar formulieren
  if (alert.threatIntel && alert.threatIntel.malicious != null) {
    const ti     = alert.threatIntel;
    const detail = ti.total != null ? `${ti.malicious}/${ti.total} Engines` : `${ti.malicious} Engine(s)`;
    if (ti.malicious >= 1) {
      add('threatintel', 'VirusTotal',
        `${detail} stufen die Datei als BÖSARTIG ein${ti.file ? ' — ' + ti.file : ''} (externer Beleg, kein False Positive)`);
    } else {
      add('threatintel', 'VirusTotal',
        `0 von ${ti.total ?? '?'} Engines bösartig — extern aktuell unauffällig`);
    }
  }

  // Prozess-Kontext
  if (alert.process?.commandLine) {
    add('process', 'CommandLine', alert.process.commandLine);
    if (/base64|encodedcommand|-enc\b|bypass|hidden|nopr/i.test(alert.process.commandLine)) {
      add('process', 'Verdächtiges Flag', 'Obfuskation/Evasion-Indikator in CommandLine erkannt');
    }
  }
  if (alert.process?.name)       add('process', 'Image',      alert.process.name);
  if (alert.process?.parentName) add('process', 'ParentImage', alert.process.parentName);
  if (alert.process?.user)       add('process', 'User',        alert.process.user);

  // Netzwerk
  if (alert.network?.srcIp)   add('network', 'Quell-IP',  alert.network.srcIp);
  if (alert.network?.dstIp)   add('network', 'Ziel-IP',   alert.network.dstIp);
  if (alert.network?.dstPort) add('network', 'Ziel-Port', alert.network.dstPort);
  if (alert.network?.action)  add('network', 'Action',    alert.network.action);

  // Auth
  if (alert.auth?.user)       add('auth', 'User',       alert.auth.user);
  if (alert.auth?.logonType)  add('auth', 'LogonType',  alert.auth.logonType);
  if (alert.auth?.status)     add('auth', 'Status',     alert.auth.status);

  // Syscheck
  if (alert.syscheck?.path)   add('fim', 'Pfad',   alert.syscheck.path);
  if (alert.syscheck?.event)  add('fim', 'Event',  alert.syscheck.event);

  // Host
  if (alert.agentName) add('host', 'Agent',   alert.agentName);
  if (alert.agentIp)   add('host', 'Agent-IP', alert.agentIp);
  if (alert.location)  add('host', 'Quelle',   alert.location);

  return obs;
}

// ── Owned-Asset-Observations ────────────────────────────────────────────────

/**
 * Taggt die beteiligten IPs mit ihrer Asset-Rolle (eigener Honeypot / intern /
 * extern). Greift auch ohne Wazuh-Alert (z. B. dataplane Cross-Domain-Tickets),
 * indem es die flachen Ticket-Netzwerkfelder liest. Ohne dieses Wissen liest die
 * KI Kommunikation zum eigenen Honeypot als „unbekannte IP".
 *
 * @param {object} ticket  Ticket-Objekt (kann srcIp/dstIp tragen)
 * @param {object} alert   Normalisierter Alert (network.srcIp/dstIp)
 * @param {{ honeypotIps?: string[], internalCidrs?: string[] }} config
 * @returns {object[]}  Observations mit category='asset'
 */
function _deriveAssetObservations(ticket, alert, config) {
  const candidates = [];
  const push = (label, ip) => { if (ip) candidates.push({ label, ip: String(ip).trim() }); };
  push('Quell-IP', ticket?.srcIp);
  push('Ziel-IP',  ticket?.dstIp);
  if (alert?.available) {
    push('Quell-IP', alert.network?.srcIp);
    push('Ziel-IP',  alert.network?.dstIp);
  }

  const seen = new Set();
  const obs = [];
  let dstIsHoneypot = false;
  let anyInternal   = false;

  for (const { label, ip } of candidates) {
    const key = `${label}|${ip}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cls = classifyIp(ip, config);
    if (!cls) continue;

    obs.push({ category: 'asset', label: `${label} ${ip}`, value: cls.label });
    if (label === 'Ziel-IP' && cls.role === 'honeypot') dstIsHoneypot = true;
    if (cls.role === 'internal') anyInternal = true;
  }

  // Synthese: Ziel ist eigener Honeypot und kein interner Host beteiligt →
  // externe Interaktion mit dem Decoy. Das entkräftet die Cross-Domain-C2/Exfil-These.
  if (dstIsHoneypot && !anyInternal) {
    obs.push({
      category: 'asset',
      label: 'Einordnung',
      value: 'Ziel ist ein eigener Honeypot (Decoy); kein interner Host beteiligt — '
        + 'externe Interaktion mit Decoy (erwartetes Honeypot-Verhalten, nicht Cross-Domain-C2/Exfiltration).',
    });
  }

  return obs;
}

// ── Threat-Intel-Observations aus Ticket/Evidence ─────────────────────────────

function _parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function _asArray(value) {
  return Array.isArray(value) ? value : [];
}

function _collectThreatIntelEntries(ticket, evidence) {
  const entries = [];

  const push = (entry, origin) => {
    if (entry && typeof entry === 'object') entries.push({ ...entry, origin });
  };

  for (const entry of _asArray(ticket?.threatIntel)) push(entry, 'ticket');
  for (const entry of _asArray(ticket?.network?.threatIntel)) push(entry, 'ticket.network');

  for (const entry of _asArray(ticket?.tiEntries)) {
    const parts = [
      entry.category ? `Kategorie=${entry.category}` : '',
      entry.actor ? `Actor=${entry.actor}` : '',
      entry.malware ? `Malware=${entry.malware}` : '',
      entry.confidence ? `Confidence=${entry.confidence}` : '',
    ].filter(Boolean);
    if (parts.length) {
      push({
        indicatorValue: entry.actor || entry.malware || entry.category || 'manual-ti',
        verdict: 'unknown',
        confidence: entry.confidence,
        summary: parts.join('; '),
        manual: true,
      }, 'ticket.tiEntries');
    }
  }

  for (const e of _asArray(evidence)) {
    const isThreatIntel = e?.type === 'threat_intel' || e?.source === 'threatIntel';
    if (!isThreatIntel) continue;
    const parsed = _parseJsonMaybe(e.rawText ?? e.value ?? e.rawValue ?? e.raw);
    if (parsed) push(parsed, 'evidence');
    else if (e.title || e.comment) {
      push({
        indicatorValue: e.title || 'threat-intel-evidence',
        verdict: 'unknown',
        confidence: e.confidence,
        summary: e.comment || e.rawText || '',
      }, 'evidence');
    }
  }

  return entries;
}

function _tiDetail(entry) {
  const parts = [];
  if (entry.verdict) parts.push(`Verdict=${entry.verdict}`);
  if (entry.score != null) parts.push(`Score=${entry.score}`);
  if (entry.confidence != null) parts.push(`Confidence=${entry.confidence}`);
  if (entry.source) parts.push(`Source=${entry.source}`);
  if (entry.country) parts.push(`Country=${entry.country}`);
  if (entry.asnOwner) parts.push(`ASN=${entry.asnOwner}`);
  if (entry.usageType) parts.push(`Usage=${entry.usageType}`);
  if (entry.totalReports != null) parts.push(`Reports=${entry.totalReports}`);
  if (entry.summary) parts.push(String(entry.summary).slice(0, 240));
  return parts.join('; ');
}

function _isMaliciousThreatIntel(entry) {
  return String(entry?.verdict || '').toLowerCase() === 'malicious'
    || Number(entry?.score || 0) >= 90;
}

function _looksLikeScanner(entry) {
  const providerDetails = (entry.providers || [])
    .map((p) => Object.values(p?.details || {}).join(' '))
    .join(' ');
  const haystack = [
    entry.summary,
    entry.usageType,
    entry.asnOwner,
    entry.source,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    providerDetails,
  ].filter(Boolean).join(' ').toLowerCase();

  return /scanner|scan|crawler|internet[- ]?measurement|research|shodan|censys|shadowserver|masscan|zgrab|data center|hosting|transit/.test(haystack);
}

function _deriveThreatIntelObservations(ticket, evidence, existingObservations = []) {
  const obs = [];
  const entries = _collectThreatIntelEntries(ticket, evidence);
  const targetIsHoneypot = existingObservations.some(
    (o) => o.category === 'asset' && /ziel-ip/i.test(o.label) && /honeypot/i.test(o.value)
  );

  const seen = new Set();
  for (const entry of entries) {
    const indicator = String(entry.indicatorValue || entry.value || entry.indicator || entry.ip || '').trim();
    const key = `${entry.origin}|${indicator}|${entry.summary || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = entry.manual
      ? `Ticket-TI ${indicator}`
      : `Indicator ${indicator || 'unknown'}`;
    const detail = _tiDetail(entry);
    if (detail) obs.push({ category: 'threatintel', label, value: detail });

    if (targetIsHoneypot && !_isMaliciousThreatIntel(entry) && _looksLikeScanner(entry)) {
      obs.push({
        category: 'threatintel',
        label: 'Scanner-Kontext',
        value: 'Quell-IP passt zu Scanner-/Internet-Measurement-Kontext; bei Ziel Honeypot spricht das eher fuer erwartete Decoy-Interaktion als fuer bestaetigte C2/Exfiltration.',
      });
    }
  }

  return obs;
}

// ── Fehlende Daten zusammenführen ───────────────────────────────────────────

function _collectMissingData(alert, evidence) {
  const missing = new Set(alert?.missingFields ?? []);

  // Zusätzliche Prüfungen
  if (!evidence || evidence.length === 0) missing.add('evidence (keine DB-Einträge)');
  if (alert?.available && !alert.fullLog)  missing.add('full_log');

  return [...missing];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Baut ein EvidenceBundle aus Ticket + Evidence-Array.
 *
 * @param {object}   ticket      Ticket-Objekt (aus DB / getFormData)
 * @param {object[]} evidence    Evidence-Einträge (aus DB), kann leer sein
 * @param {{ honeypotIps?: string[], internalCidrs?: string[] }} [assetConfig]
 *        Owned-Asset-Konfiguration; default aus ENV (injizierbar für Tests).
 * @returns {EvidenceBundle}
 */
function build(ticket, evidence = [], assetConfig) {
  const config = assetConfig || loadConfigFromEnv();

  // 1. Wazuh-Alert finden: erst in Evidence, dann im Log-Fallback
  const rawAlert = _extractAlertFromEvidence(evidence)
    ?? _extractAlertFromLogs(ticket);

  // 2. Normalisieren
  const wazuhAlert = normalize(rawAlert);

  // 3. Observations ableiten (Alert-Signale + Owned-Asset-Kontext)
  const baseObservations = [
    ..._deriveObservations(wazuhAlert),
    ..._deriveAssetObservations(ticket, wazuhAlert, config),
  ];
  const derivedObservations = [
    ...baseObservations,
    ..._deriveThreatIntelObservations(ticket, evidence, baseObservations),
  ];

  // 4. Fehlende Daten
  const missingData = _collectMissingData(wazuhAlert, evidence);

  return new EvidenceBundle({
    ticket,
    wazuhAlert,
    evidence,
    derivedObservations,
    missingData,
  });
}

module.exports = { build };
