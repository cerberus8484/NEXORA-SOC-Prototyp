'use strict';

// Baut aus einem (Wazuh-)Ticket eine ParsedEvidence-Struktur fürs Analysis-Deck.
// Quelle: bevorzugt das Roh-Event (JSON in ticket.logs), Fallback = flache Ticketfelder.
// Rein (keine Seiteneffekte) → gut testbar.

const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

// Roh-Alert-JSON aus dem logs-Feld extrahieren (vom WazuhProcessor als "Raw Alert (JSON):" abgelegt).
function extractRaw(logs) {
  if (!logs || typeof logs !== 'string') return null;
  const marker = 'Raw Alert (JSON):';
  const i = logs.indexOf(marker);
  if (i === -1) return null;
  try { return JSON.parse(logs.slice(i + marker.length).trim()); } catch { return null; }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const str = (v) => (v == null || v === '' ? undefined : String(v));
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') || undefined : str(v));

// Windows-Prozess-Evidence aus win.eventdata (Sysmon EventID 1 ODER Security 4688
// ODER PowerShell ScriptBlock-Logging Event 4104 → scriptBlockText als Command).
function buildProcess(win = {}) {
  const image       = str(win.image || win.newProcessName);
  const commandLine = str(win.commandLine || win.processCommandLine || win.scriptBlockText);
  const parentImage = str(win.parentImage || win.parentProcessName);
  if (!image && !commandLine && !parentImage) return undefined; // kein Prozess-Event
  return {
    image,
    commandLine,
    parentImage,
    parentCommandLine: str(win.parentCommandLine),
    user:        str(win.user || win.subjectUserName || win.targetUserName),
    logonId:     str(win.logonId || win.subjectLogonId || win.targetLogonId),
    processId:   str(win.processId || win.newProcessId),
    processGuid: str(win.processGuid),
    parentProcessId: str(win.parentProcessId),
    currentDirectory: str(win.currentDirectory),
    integrityLevel:   str(win.integrityLevel || win.tokenElevationType),
    originalFileName: str(win.originalFileName),
    hashes: str(win.hashes),
  };
}

/**
 * @param {object} ticket  Domain-Ticket (toJSON-Form)
 * @returns {object} ParsedEvidence (gleiche Form wie das Frontend-Modell)
 */
function normalizeWazuhEvidence(ticket = {}) {
  const raw   = extractRaw(ticket.logs) || {};
  const d     = raw.data || {};
  const rule  = raw.rule || {};
  const agent = raw.agent || {};
  const mitre = rule.mitre || {};
  const win   = (d.win && d.win.eventdata) || {};
  const sys   = (d.win && d.win.system) || {};

  // Rule-/Agent-ID notfalls aus der offenseId (wazuh:rule:<id>:agent:<id>) ableiten.
  const m       = /wazuh:rule:([^:]+):agent:(.+)/.exec(ticket.offenseId || '');
  const ruleId  = str(rule.id) || (m ? m[1] : undefined);
  const agentId = str(agent.id) || (m ? m[2] : undefined);

  // Windows Process Creation (Sysmon EventID 1 / Security 4688) — beide Feldnamen-Konventionen.
  // Cowrie-Honeypot (data.input = abgesetzter Befehl) → als Command-Evidence behandeln.
  const proc = buildProcess(win)
    || (str(d.input) ? { commandLine: str(d.input), user: str(d.username) } : undefined);

  // Sysmon EventID 22: DNS-Query (queryName/queryResults/queryStatus).
  const dns = win.queryName ? {
    query: str(win.queryName),
    answers: str(win.queryResults),
    status: str(win.queryStatus),
  } : undefined;

  // Sysmon EventID 11: FileCreate — die ERZEUGTE Datei ist der eigentliche Artefakt/IoC.
  const file = win.targetFilename ? {
    name: str(win.targetFilename),
    hashes: str(win.hashes),
  } : undefined;

  // Windows EventChannel (win.system): viele Windows-Regeln (z. B. WMI-Activity)
  // tragen ihre Inhalte HIER statt in eventdata — sonst bliebe das Deck leer.
  const windowsEvent = (sys.eventID || sys.providerName || sys.channel || sys.message) ? {
    eventId:  str(sys.eventID),
    provider: str(sys.providerName),
    channel:  str(sys.channel),
    computer: str(sys.computer),
    message:  str(sys.message),
  } : undefined;

  return {
    id: ticket.id || '',
    type: dns ? 'dns' : file ? 'process' : (proc && proc.commandLine) ? 'process' : windowsEvent ? 'alert' : 'network',
    detection: {
      sourceSystem: 'Wazuh',
      ruleId,
      ruleName: str(rule.description) || str(ticket.title),
      severity: SEV_LABEL[ticket.priority] || undefined,
      timestamp: str(ticket.datetime) || str(ticket.createdAt),
      status: undefined,
      description: str(ticket.description) || str(rule.description) || str(sys.message),
    },
    source: {
      host: str(agent.name) || str(win.computer) || str(sys.computer) || str(ticket.hostname),
      user: str(d.srcuser) || str(win.user || win.subjectUserName || win.targetUserName) || str(ticket.user),
      ip: str(d.srcip) || str(d.src_ip) || str(win.sourceIp) || str(ticket.srcIp),
      port: num(d.srcport) ?? num(d.src_port) ?? (win.sourcePort ? num(win.sourcePort) : undefined) ?? (ticket.port ? num(ticket.port) : undefined),
      zone: str(d.zone) || str(ticket.network),
      interface: str(d.iface || d.interface),
      macAddress: str(d.smac) || str(ticket.mac),
    },
    destination: {
      ip: str(d.dstip) || str(d.dst_ip) || str(win.destinationIp) || str(ticket.dstIp),
      port: num(d.dstport) ?? num(d.dst_port) ?? (win.destinationPort ? num(win.destinationPort) : undefined),
      fqdn: str(d.dsthost) || str(win.destinationHostname) || (dns ? dns.query : undefined) || str(ticket.dstFqdn),
      sni: undefined,
      httpHost: str((d.url && d.url.hostname) || d.http_host),
      country: str(d.geoip && d.geoip.country_name),
      asn: str(d.geoip && d.geoip.asn),
      organization: str(d.geoip && d.geoip.org),
      reputation: undefined, // erst mit Threat-Intel-Service (P17)
    },
    nat: {
      originalSourceIp: str(d.srcip) || str(ticket.srcIp),
      originalSourcePort: num(d.srcport),
      postNatSourceIp: str(ticket.postNatSrc),
      postNatSourcePort: undefined,
      originalDestinationIp: str(d.dstip) || str(ticket.dstIp),
      originalDestinationPort: num(d.dstport),
      postNatDestinationIp: str(ticket.postNatDst),
      postNatDestinationPort: undefined,
      natType: undefined,
      firewallRule: str(d.rulenum || d.rule),
    },
    network: {
      protocol: str(d.protocol || d.proto) || str(win.protocol) || str(ticket.protocol),
      transport: str(d.transport),
      direction: str(d.direction) || (win.initiated === 'true' ? 'outbound' : undefined),
      // Sysmon (Event 3) ist KEINE Firewall: eine geloggte Verbindung = sie fand statt (anders als 'block').
      action: str(d.action) || (win.initiated === 'true' ? 'initiated (connection logged)' : undefined),
      connectionState: str(d.state),
      bytesSent: num(d.bytes_out || ticket.bytesSent),
      bytesReceived: num(d.bytes_in || ticket.bytesRecv),
      packetsSent: num(d.packets_out),
      packetsReceived: num(d.packets_in),
      durationMs: undefined,
      firewallRule: str(d.rulenum || d.rule),
    },
    payload: {
      type: undefined,
      method: str(d.method || (d.url && d.url.method)),
      url: str(d.url && (d.url.full || d.url.original)) || str(d.full_url),
      hostHeader: str(d.http_host),
      userAgent: str(d.user_agent),
      contentType: str(d.content_type),
      statusCode: num(d.status || d.http_status),
      contentLength: num(d.content_length),
      preview: str(raw.full_log),
      containsCredentials: 'unknown',
      containsToken: 'unknown',
      containsScript: 'unknown',
      containsBase64: 'unknown',
      suspiciousKeywords: undefined,
    },
    metadata: {
      mitreTactic: arr(mitre.tactic),
      mitreTechnique: str(ticket.mitre) || arr(mitre.id) || arr(mitre.technique),
      logSource: str(raw.location) || arr(rule.groups) || str(sys.channel),
      agentId,
      agentName: str(agent.name) || str(ticket.hostname),
    },
    process: proc,
    dns,
    file,
    windowsEvent,
    firstSeen: str(ticket.createdAt),
    lastSeen: str(ticket.updatedAt),
    raw: Object.keys(raw).length ? raw : undefined,
  };
}

module.exports = { normalizeWazuhEvidence, extractRaw };
