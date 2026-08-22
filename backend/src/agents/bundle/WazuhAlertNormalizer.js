'use strict';

/**
 * WazuhAlertNormalizer — P18.1 AI Evidence Bundle
 *
 * Nimmt ein raw Wazuh-Alert-JSON (wie es vom Webhook kommt) und normalisiert
 * es in ein stabiles, gut dokumentiertes Objekt für den KI-Prompt.
 *
 * Designprinzipien:
 *  - Defensiv: kein Feld bricht die Verarbeitung. Fehlende Felder → undefined.
 *  - Verlustfrei: `raw` bleibt immer vollständig erhalten.
 *  - Kein Werfen: gibt bei ungültigem Input ein "leeres" Ergebnis zurück.
 *  - Decoder-agnostisch: greift auf mehrere mögliche Pfade zu (sysmon, win, data.*).
 */

const str  = (v) => (v == null || v === '' ? undefined : String(v).trim());
const num  = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const arr  = (v) => (Array.isArray(v) && v.length ? v.map(String).filter(Boolean) : undefined);
const pick = (...vals) => vals.map(str).find((v) => v !== undefined);

/** Parst SHA256 aus Sysmon hashes-String: "SHA256=abc...,MD5=..." → "abc". */
function parseHashSha256(hashesStr) {
  if (!hashesStr) return undefined;
  const m = String(hashesStr).match(/SHA256=([A-Fa-f0-9]{64})/i);
  return m ? m[1].toUpperCase() : undefined;
}

// ── Prozess-Daten aus verschiedenen Decoder-Pfaden ──────────────────────────

function extractProcess(raw) {
  const d   = raw.data    || {};
  const win = d.win       || {};
  const ed  = win.eventdata || {};
  const sys = d.sysmon    || {};

  const image       = pick(ed.image, ed.newProcessName, sys.image, d.process_name, d.processName);
  const commandLine = pick(ed.commandLine, ed.processCommandLine, sys.commandLine, d.command_line, d.commandLine);
  const parentImage = pick(ed.parentImage, ed.parentProcessName, sys.parentImage);

  if (!image && !commandLine && !parentImage) return undefined;

  const hashesRaw = pick(ed.hashes, d.hash, d.sha256);

  return {
    name:             image,
    commandLine,
    parentName:       parentImage,
    parentCommandLine:pick(ed.parentCommandLine, sys.parentCommandLine),
    user:             pick(ed.user, ed.subjectUserName, ed.targetUserName, d.srcuser),
    pid:              str(pick(ed.processId, ed.newProcessId, sys.processId)),
    ppid:             str(pick(ed.parentProcessId, sys.parentProcessId)),
    hash:             hashesRaw,
    hashSha256:       parseHashSha256(hashesRaw),
    integrityLevel:   pick(ed.integrityLevel, ed.tokenElevationType),
    workingDirectory: pick(ed.currentDirectory, d.working_directory),
    originalFileName: pick(ed.originalFileName, sys.originalFileName),
    company:          pick(ed.company, sys.company),
    signed:           pick(ed.signed, sys.signed),
    publisher:        pick(ed.signature, ed.signatureStatus, sys.signature),
  };
}

// ── Netzwerk-Daten ──────────────────────────────────────────────────────────

function extractNetwork(raw) {
  const d  = raw.data || {};
  const ed = (d.win || {}).eventdata || {};   // Sysmon NetworkConnect (Event 3)

  const srcIp   = pick(d.srcip,  d.src_ip,  d.source_ip, ed.sourceIp);
  const dstIp   = pick(d.dstip,  d.dst_ip,  d.dest_ip,  d.destination_ip, ed.destinationIp);
  const dstPort = pick(d.dstport, d.dst_port, d.destination_port, ed.destinationPort);
  const proto   = pick(d.proto,  d.protocol, ed.protocol);
  const action  = pick(d.action, d.firewall_action);
  const srcPort = pick(d.srcport, d.src_port, ed.sourcePort);
  const iface   = pick(d.interface, d.net_interface);
  const srcHost = pick(ed.sourceHostname, d.source_hostname);
  const dstHost = pick(ed.destinationHostname, d.destination_hostname);
  const image   = pick(ed.image);              // Prozess, der die Verbindung aufbaute
  // Sysmon "initiated": true = ausgehend, false = eingehend.
  const initiated = pick(ed.initiated);
  const direction = initiated === 'true' ? 'outbound' : initiated === 'false' ? 'inbound' : undefined;

  if (!srcIp && !dstIp && !dstPort) return undefined;

  return { srcIp, srcPort, srcHostname: srcHost, dstIp, dstPort, dstHostname: dstHost,
    protocol: proto, action, direction, interface: iface, image };
}

// ── DNS-Abfragen (Sysmon DnsQuery Event 22) ──────────────────────────────────

function extractDns(raw) {
  const ed = ((raw.data || {}).win || {}).eventdata || {};
  const query = pick(ed.queryName, (raw.data || {}).dns_query);
  if (!query) return undefined;

  // queryResults: "type: 5 cname.example.com;type: 1 1.2.3.4;" → reine Antwortwerte.
  const resultsRaw = pick(ed.queryResults);
  const answers = resultsRaw
    ? String(resultsRaw).split(';').map((s) => s.replace(/^\s*type:\s*\d+\s*/i, '').trim()).filter(Boolean)
    : [];

  return {
    query,
    answers:    answers.length ? answers : undefined,
    answersStr: answers.length ? answers.join(', ') : undefined,
    status:     pick(ed.queryStatus),
    image:      pick(ed.image),
  };
}

// ── Registry-Daten (Sysmon RegistryEvent 12/13/14, IFEO etc.) ────────────────

function extractRegistry(raw) {
  const d   = raw.data    || {};
  const ed  = (d.win || {}).eventdata || {};
  const key = pick(ed.targetObject, d.registry_key, d.path, d.key);
  const operation = pick(ed.eventType, d.operation, d.event_type);
  const newValue  = pick(ed.details, d.new_value, d.value);
  const valueName = pick(ed.valueName, d.value_name);
  const oldValue  = pick(d.old_value, ed.previousDetails);
  if (!key && !operation && !newValue && !valueName) return undefined;
  return { key, valueName, oldValue, newValue, operation };
}

// ── Authentifizierungs-Daten ─────────────────────────────────────────────────

function extractAuth(raw) {
  const d   = raw.data    || {};
  const win = d.win       || {};
  const ed  = win.eventdata || {};

  const user   = pick(ed.targetUserName, ed.subjectUserName, d.srcuser, d.dstuser, d.user);
  const domain = pick(ed.targetDomainName, ed.subjectDomainName, ed.logonDomain, d.domain);
  const logon  = pick(ed.logonType, d.logon_type);
  const status = pick(ed.status, ed.subStatus, d.auth_status);
  const sid       = pick(ed.subjectUserSid, ed.targetUserSid);
  const privilege = pick(ed.privilegeList, ed.tokenElevationType);

  if (!user && !domain) return undefined;

  return { user, domain, logonType: logon, status, sid, privilege };
}

// ── Syscheck (File-Integrity-Monitoring) ─────────────────────────────────────

function extractSyscheck(raw) {
  const sc = raw.syscheck || {};
  const path = pick(sc.path, sc.file);
  if (!path) return undefined;

  return {
    path,
    event:    pick(sc.event),
    size:     str(sc.size_after),
    md5:      pick(sc.md5_after,  sc.md5),
    sha256:   pick(sc.sha256_after, sc.sha256),
    owner:    pick(sc.uname_after, sc.uid_after),
    modified: pick(sc.mtime_after),
  };
}

// ── Datei (FIM/Syscheck ODER Sysmon FileCreate Event 11) ─────────────────────

function extractFile(raw) {
  const sc = raw.syscheck || {};
  const scPath = pick(sc.path, sc.file);
  const ed = ((raw.data || {}).win || {}).eventdata || {};
  const sysmonPath = pick(ed.targetFilename);

  const path = scPath || sysmonPath;
  if (!path) return undefined;

  const lastSep   = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  const name      = lastSep >= 0 ? path.slice(lastSep + 1) : path;
  const directory = lastSep >= 0 ? path.slice(0, lastSep) : undefined;
  const hashSha256 = pick(sc.sha256_after, sc.sha256) || parseHashSha256(pick(ed.hashes));
  const signed     = pick(ed.signed, sc.signed);

  return { name, path, directory, hashSha256, signed };
}

// ── Threat Intel (VirusTotal-Integration) ────────────────────────────────────

/**
 * Extrahiert das VirusTotal-Ergebnis aus der Wazuh-VT-Integration
 * (`data.virustotal`). Das ist das stärkste externe Signal für die Verdict-
 * Findung — darf NICHT verloren gehen (sonst stuft die KI bösartige Funde als
 * False Positive ein). Unterstützt altes (`positives/total`) und neues
 * (`malicious`) Integrationsschema.
 *
 * @param {object} raw  Rohes Wazuh-Alert-JSON
 * @returns {object|undefined}
 */
function extractThreatIntel(raw) {
  const vt = (raw.data || {}).virustotal;
  if (!vt || typeof vt !== 'object') return undefined;

  const src = vt.source || {};
  const malicious = num(vt.malicious) ?? num(vt.positives);
  const total     = num(vt.total);

  const ti = {
    source:    'VirusTotal',
    found:     num(vt.found),
    malicious,
    total,
    permalink: pick(vt.permalink),
    file:      pick(src.file, vt.source_file),
    md5:       pick(src.md5, vt.md5),
    sha1:      pick(src.sha1, vt.sha1),
    scanDate:  pick(vt.scan_date),
  };

  // Nur zurückgeben, wenn überhaupt ein verwertbares Signal vorliegt.
  if (ti.malicious == null && ti.found == null && !ti.permalink) return undefined;
  return ti;
}

// ── Fehlende Felder ermitteln ────────────────────────────────────────────────

function detectMissingData(normalized) {
  const missing = [];
  if (!normalized.agentIp)            missing.push('agent.ip');
  if (!normalized.process)            missing.push('process.commandLine');
  if (!normalized.network)            missing.push('network.srcIp / dstIp');
  if (!normalized.fullLog)            missing.push('full_log');
  if (!normalized.mitreTechniques?.length) missing.push('mitre.technique');
  return missing;
}

// ── Hauptfunktion ────────────────────────────────────────────────────────────

/**
 * Normalisiert ein Wazuh-Alert-JSON in ein stabiles Objekt.
 * Gibt bei null/undefined/ungültigem Input ein Objekt mit `available: false` zurück.
 *
 * @param {object|null} rawAlert  Rohes Wazuh-Alert-JSON
 * @returns {object}  Normalisierter Alert
 */
function normalize(rawAlert) {
  if (!rawAlert || typeof rawAlert !== 'object') {
    return { available: false, raw: rawAlert ?? null };
  }

  const rule  = rawAlert.rule    || {};
  const agent = rawAlert.agent   || {};
  const mgr   = rawAlert.manager || {};
  const mitre = rule.mitre       || {};

  const normalized = {
    available:       true,

    // Alert-Identität
    alertId:         str(rawAlert.id),
    timestamp:       str(rawAlert.timestamp),

    // Regel
    ruleId:          str(rule.id),
    ruleLevel:       num(rule.level),
    ruleDescription: str(rule.description),
    ruleGroups:      arr(rule.groups),

    // MITRE
    mitreTactics:    arr(mitre.tactic),
    mitreTechniques: arr(mitre.id || mitre.technique),

    // Agent (betroffener Host)
    agentId:         str(agent.id),
    agentName:       str(agent.name),
    agentIp:         str(agent.ip),

    // Manager
    managerName:     str(mgr.name || rawAlert.manager),

    // Log-Quelle
    decoderName:     str(rawAlert.decoder?.name || rawAlert.decoder),
    location:        str(rawAlert.location),

    // Originallog (nie wegwerfen)
    fullLog:         str(rawAlert.full_log),

    // Decoder-spezifische Extrakte
    network:         extractNetwork(rawAlert),
    dns:             extractDns(rawAlert),
    process:         extractProcess(rawAlert),
    auth:            extractAuth(rawAlert),
    registry:        extractRegistry(rawAlert),
    syscheck:        extractSyscheck(rawAlert),
    file:            extractFile(rawAlert),
    threatIntel:     extractThreatIntel(rawAlert),

    // Rohes JSON immer vollständig erhalten
    raw: rawAlert,
  };

  normalized.missingFields = detectMissingData(normalized);

  return normalized;
}

module.exports = { normalize };
