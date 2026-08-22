'use strict';

const { LOG_LEVEL } = require('./HuntLog');
const { EXTENDED_HUNT_TYPES } = require('./huntTypeExtended');
const { pctToConfidence } = require('./huntTypeFactory');

/**
 * Hunt-Typ-Definitionen — deterministische, mock-backed Hunts.
 *
 * WICHTIG (Safety): Hier wird NICHTS remote ausgeführt. Die "safe commands"
 * sind reine Anzeige-Strings im Log. Kein child_process, keine freie Shell,
 * keine destruktiven Aktionen, keine externen Provider-Calls.
 *
 * Jede Definition liefert build(session) → { logs[], findings[] }.
 * Ein Log = { level, message }. Ein Finding = HuntFinding.create-DTO inkl. context.
 * `pctToConfidence` kommt aus huntTypeFactory (Single Source of Truth für die Schwelle).
 */

const HUNT_TYPES = {
  // ── A) Suspicious PowerShell ───────────────────────────────────────────────
  suspicious_powershell_hunt: {
    label: 'Suspicious PowerShell Hunt',
    description: 'Findet verschleierte/encoded PowerShell-Ausführung (z.B. -EncodedCommand) und ungewöhnliche Parent-Prozesse wie WINWORD.',
    category: 'Execution',
    mitre: 'T1059.001',
    dataSources: ['Wazuh', 'Sysmon', 'Windows Agent'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '192.168.240.44',
    riskLevel: 'high',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const ip   = session.context?.sourceIp || '192.168.240.44';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: suspicious_powershell_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host} (${ip})`],
        [LOG_LEVEL.INFO, 'Data Sources: Wazuh, Sysmon, Windows Agent'],
        [LOG_LEVEL.INFO, 'Collector started: process_context'],
        [LOG_LEVEL.INFO, 'Running safe command: tasklist /v'],
        [LOG_LEVEL.INFO, 'Running safe query: process command line'],
        [LOG_LEVEL.INFO, 'Parsing command lines'],
        [LOG_LEVEL.WARNING, 'Suspicious PowerShell detected'],
        [LOG_LEVEL.INFO, 'Process: powershell.exe -EncodedCommand SQBFAFgA...'],
        [LOG_LEVEL.INFO, 'User: max.mustermann'],
        [LOG_LEVEL.INFO, 'PID: 4528 Parent PID: 3896 (WINWORD.EXE)'],
        [LOG_LEVEL.SUCCESS, 'Evidence created: ev-2026-000421'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious PowerShell Execution (High)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious PowerShell Execution',
        description: 'Encoded PowerShell command detected. This technique is often used by attackers to obfuscate malicious code.',
        severity: 'high',
        confidence: pctToConfidence(91),
        mitreAttack: 'T1059.001',
        recommendation: [
          'Check parent process and user activity',
          'Review encoded command content',
          'Validate user action',
          'Continue monitoring this host',
        ].join('\n'),
        context: {
          host, user: 'max.mustermann', sourceIp: '', process: 'powershell.exe',
          parentProcess: 'WINWORD.EXE (3896)', pid: 4528,
          commandLine: 'powershell.exe -EncodedCommand SQBFAFgA...',
          mitreTactic: 'Execution', mitreTechnique: 'T1059.001',
          source: 'Sysmon', verdict: 'unknown', status: 'new', confidencePct: 91,
        },
      }];
      return { logs, findings };
    },
  },

  // ── B) OPNsense Multicast Review ───────────────────────────────────────────
  opnsense_multicast_review: {
    label: 'OPNsense Multicast Review',
    description: 'Prüft Firewall-/OPNsense-Events auf lokales Multicast-Rauschen (224.0.0.0/24) und markiert False-Positive-Kandidaten.',
    category: 'Network / FP-Review',
    mitre: '',
    dataSources: ['OPNsense', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'OPNsense-fw',
    defaultIp: '192.168.240.109',
    riskLevel: 'low',
    build(session) {
      const host = session.targetHost || 'OPNsense-fw';
      const srcIp = session.context?.sourceIp || '192.168.240.109';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: opnsense_multicast_review'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Wazuh/OPNsense events'],
        [LOG_LEVEL.INFO, 'Filtering rule 87702'],
        [LOG_LEVEL.INFO, 'Checking destination multicast ranges'],
        [LOG_LEVEL.WARNING, 'Found UDP traffic to 224.0.0.7:5353'],
        [LOG_LEVEL.INFO, 'Threat Intel classified destination as local multicast'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Likely multicast firewall noise (Low)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Local multicast firewall noise / FP candidate',
        description: 'UDP traffic to a local multicast address (mDNS). Classified as likely benign firewall noise / false-positive candidate.',
        severity: 'low',
        confidence: pctToConfidence(86),
        mitreAttack: '',
        recommendation: [
          'Review scope',
          'Consider scoped FP exception only if repeated and expected',
          'Do not disable parent rule globally',
        ].join('\n'),
        context: {
          host, sourceIp: srcIp, destinationIp: '224.0.0.7', destinationPort: 5353,
          protocol: 'UDP', source: 'OPNsense / Wazuh', ruleId: '87702',
          verdict: 'benign', status: 'new', confidencePct: 86,
        },
      }];
      return { logs, findings };
    },
  },

  // ── C) RDP Exposure Hunt ───────────────────────────────────────────────────
  rdp_exposure_hunt: {
    label: 'RDP Exposure Hunt',
    description: 'Prüft, ob RDP (Port 3389) auf einem Host exponiert/erreichbar ist — häufiger Initial-Access-Vektor.',
    category: 'Exposure',
    mitre: 'T1021.001',
    dataSources: ['Nmap Scan', 'Host Inventory'],
    targetType: 'host',
    defaultTarget: 'Server-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Server-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: rdp_exposure_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Checking host exposure'],
        [LOG_LEVEL.INFO, 'Checking port 3389'],
        [LOG_LEVEL.WARNING, 'RDP service detected'],
        [LOG_LEVEL.SUCCESS, 'Finding created: RDP Port 3389 exposed (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'RDP Port 3389 exposed',
        description: 'RDP service detected on port 3389. Exposed RDP is a common initial-access vector.',
        severity: 'medium',
        confidence: pctToConfidence(78),
        mitreAttack: 'T1021.001',
        recommendation: [
          'Restrict RDP exposure',
          'Require VPN/MFA',
          'Review firewall rules',
        ].join('\n'),
        context: {
          host, destinationPort: 3389, protocol: 'TCP',
          source: 'Nmap Scan / Host Inventory',
          mitreTactic: 'Lateral Movement', mitreTechnique: 'T1021.001',
          verdict: 'suspicious', status: 'new', confidencePct: 78,
        },
      }];
      return { logs, findings };
    },
  },

  // ── D) Persistence Hunt ────────────────────────────────────────────────────
  persistence_hunt: {
    label: 'Persistence Hunt',
    description: 'Sucht nach Persistenz-Mechanismen: Run-Keys, Scheduled Tasks, Services und Autoruns.',
    category: 'Persistence',
    mitre: 'T1547.001',
    dataSources: ['Sysmon', 'Windows Agent', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: persistence_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Collector started: autoruns_context'],
        [LOG_LEVEL.INFO, 'Running safe query: Get-Service'],
        [LOG_LEVEL.INFO, 'Enumerating Run keys + scheduled tasks'],
        [LOG_LEVEL.WARNING, 'Suspicious autorun entry detected'],
        [LOG_LEVEL.INFO, 'Registry: HKCU\\...\\Run\\Updater → %APPDATA%\\svc.exe'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious persistence entry (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious persistence entry',
        description: 'Autorun-/Run-Key-Eintrag startet eine Binary aus %APPDATA% — typisches Persistenz-Muster.',
        severity: 'medium',
        confidence: pctToConfidence(72),
        mitreAttack: 'T1547.001',
        recommendation: ['Run-Key & Task prüfen', 'Binary-Hash gegen Threat Intel', 'Bei Bestätigung Host isolieren (Genehmigung)'].join('\n'),
        context: {
          host, process: 'svc.exe', commandLine: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater = %APPDATA%\\svc.exe',
          mitreTactic: 'Persistence', mitreTechnique: 'T1547.001', source: 'Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 72,
        },
      }];
      return { logs, findings };
    },
  },

  // ── E) Failed Logon Hunt ───────────────────────────────────────────────────
  failed_logon_hunt: {
    label: 'Failed Logon Hunt',
    description: 'Erkennt Brute-Force-/Password-Spraying-Muster über gehäufte fehlgeschlagene Logons.',
    category: 'Credential Access',
    mitre: 'T1110',
    dataSources: ['Wazuh', 'Windows Security Log'],
    targetType: 'host',
    defaultTarget: 'Linux-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Linux-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: failed_logon_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying authentication events (Wazuh rule 5710/5716)'],
        [LOG_LEVEL.INFO, 'Aggregating failed logons per source'],
        [LOG_LEVEL.WARNING, '38 failed logons from 203.0.113.55 in 4 min'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Possible brute force (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Multiple failed logons detected',
        description: 'Gehäufte fehlgeschlagene Logons aus einer einzelnen Quelle — mögliches Brute-Force/Password-Spraying.',
        severity: 'medium',
        confidence: pctToConfidence(70),
        mitreAttack: 'T1110',
        recommendation: ['Quell-IP gegen Threat Intel prüfen', 'Account-Lockout/Lockdown erwägen', 'Bei Erfolg eskalieren'].join('\n'),
        context: {
          host, user: 'root', sourceIp: '203.0.113.55',
          mitreTactic: 'Credential Access', mitreTechnique: 'T1110', source: 'Wazuh', verdict: 'suspicious', status: 'new', confidencePct: 70,
        },
      }];
      return { logs, findings };
    },
  },

  // ── F) DNS Tunneling Hunt ──────────────────────────────────────────────────
  dns_tunneling_hunt: {
    label: 'DNS Tunneling Hunt',
    description: 'Sucht nach DNS-Exfiltration/-Tunneling: ungewöhnlich lange/häufige Queries zu seltenen Domains.',
    category: 'Exfiltration / C2',
    mitre: 'T1071.004',
    dataSources: ['Zeek', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'DNS-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'DNS-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: dns_tunneling_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying DNS logs (Zeek dns.log)'],
        [LOG_LEVEL.INFO, 'Scoring query length + entropy + frequency'],
        [LOG_LEVEL.WARNING, 'High-entropy subdomains to rare domain detected'],
        [LOG_LEVEL.INFO, 'Domain: a8f3k2.exfil.example.com (entropy 4.1)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Possible DNS tunneling (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'DNS query to rare domain (possible tunneling)',
        description: 'Hochentropische Subdomains zu einer selten aufgelösten Domain — Indikator für DNS-Tunneling/Exfiltration.',
        severity: 'medium',
        confidence: pctToConfidence(68),
        mitreAttack: 'T1071.004',
        recommendation: ['Domain gegen Threat Intel prüfen', 'Client-Prozess identifizieren', 'DNS-Sinkhole erwägen'].join('\n'),
        context: {
          host, sourceIp: '192.168.240.55', destinationIp: '', protocol: 'UDP',
          mitreTactic: 'Command and Control', mitreTechnique: 'T1071.004', source: 'Zeek', verdict: 'suspicious', status: 'new', confidencePct: 68,
        },
      }];
      return { logs, findings };
    },
  },

  // ── G) Scheduled Tasks Hunt ────────────────────────────────────────────────
  scheduled_tasks_hunt: {
    label: 'Scheduled Tasks Hunt',
    description: 'Sucht nach verdächtigen geplanten Aufgaben (schtasks) als Persistenz-/Ausführungsmechanismus.',
    category: 'Persistence',
    mitre: 'T1053.005',
    dataSources: ['Windows Agent', 'Sysmon'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: scheduled_tasks_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Running safe query: schtasks /query /fo LIST /v'],
        [LOG_LEVEL.INFO, 'Filtering tasks by author/trigger/action'],
        [LOG_LEVEL.INFO, 'Checking for tasks outside standard paths (non-standard / nicht Standard-Pfad)'],
        [LOG_LEVEL.INFO, 'Checking for PowerShell/cmd actions with encoded commands'],
        [LOG_LEVEL.WARNING, 'Suspicious scheduled task detected'],
        [LOG_LEVEL.INFO, 'Task: \\Microsoft\\Windows\\Updater → powershell -w hidden -enc ...'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious scheduled task (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious scheduled task',
        description: 'Geplante Aufgabe startet eine versteckte PowerShell — typischer Persistenz-/Ausführungsmechanismus.',
        severity: 'medium', confidence: pctToConfidence(74), mitreAttack: 'T1053.005',
        recommendation: ['Task-Definition + Trigger prüfen', 'Aktion/Binary gegen Threat Intel', 'Bei Bestätigung Task deaktivieren (Genehmigung)'].join('\n'),
        context: { host, process: 'powershell.exe', commandLine: 'schtasks: \\Microsoft\\Windows\\Updater → powershell -w hidden -enc ...', mitreTactic: 'Persistence', mitreTechnique: 'T1053.005', source: 'Windows Agent', verdict: 'suspicious', status: 'new', confidencePct: 74 },
      }];
      return { logs, findings };
    },
  },

  // ── H) Services Hunt ───────────────────────────────────────────────────────
  services_hunt: {
    label: 'Services Hunt',
    description: 'Prüft Windows-Dienste auf ungewöhnliche Binärpfade / unsignierte Service-Binaries.',
    category: 'Persistence',
    mitre: 'T1543.003',
    dataSources: ['Windows Agent', 'Sysmon'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: services_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Running safe query: Get-Service + Get-CimInstance Win32_Service'],
        [LOG_LEVEL.INFO, 'Resolving service binary paths + signatures'],
        [LOG_LEVEL.INFO, 'Checking for newly installed services'],
        [LOG_LEVEL.INFO, 'Checking for unquoted service paths'],
        [LOG_LEVEL.INFO, 'Checking binary paths in user directories (C:\\Users, %APPDATA%, ProgramData)'],
        [LOG_LEVEL.WARNING, 'Service with unusual binary path detected'],
        [LOG_LEVEL.INFO, 'Service: WinHelpSvc → C:\\ProgramData\\whelp.exe (unsigned, unquoted path)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious service binary (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious service binary',
        description: 'Dienst zeigt auf eine unsignierte Binary außerhalb von System32 — möglicher Persistenz-Service.',
        severity: 'medium', confidence: pctToConfidence(71), mitreAttack: 'T1543.003',
        recommendation: ['Service-Binary-Hash prüfen', 'Signatur/Pfad bewerten', 'Bei Bestätigung Service stoppen (Genehmigung)'].join('\n'),
        context: { host, process: 'whelp.exe', commandLine: 'WinHelpSvc → C:\\ProgramData\\whelp.exe', mitreTactic: 'Persistence', mitreTechnique: 'T1543.003', source: 'Windows Agent', verdict: 'suspicious', status: 'new', confidencePct: 71 },
      }];
      return { logs, findings };
    },
  },

  // ── I) Autoruns Hunt ───────────────────────────────────────────────────────
  autoruns_hunt: {
    label: 'Autoruns Hunt',
    description: 'Autostart-Persistenz-Analyse: Run-/RunOnce-Registry-Keys, Startup-Ordner, neue Einträge mit verdächtigen Pfaden.',
    category: 'Persistence',
    mitre: 'T1547.001',
    dataSources: ['Sysmon', 'Windows Agent'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: autoruns_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Collector started: autoruns_context'],
        [LOG_LEVEL.INFO, 'Enumerating Run/RunOnce registry keys (HKCU + HKLM)'],
        [LOG_LEVEL.INFO, 'Enumerating Startup folder entries'],
        [LOG_LEVEL.INFO, 'Checking new entries for suspicious paths (%APPDATA%, %TEMP%)'],
        [LOG_LEVEL.WARNING, 'Unsigned autorun in Startup folder detected'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious autorun (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious autorun entry',
        description: 'Unsignierter Autostart-Eintrag im Startup-Ordner — breit gestreute Persistenz-Technik.',
        severity: 'medium', confidence: pctToConfidence(69), mitreAttack: 'T1547.001',
        recommendation: ['Autostart-Eintrag prüfen', 'Binary-Hash gegen Threat Intel', 'Bei Bestätigung entfernen (Genehmigung)'].join('\n'),
        context: { host, process: 'updater.lnk', commandLine: 'Startup\\updater.lnk → %APPDATA%\\u.exe', mitreTactic: 'Persistence', mitreTechnique: 'T1547.001', source: 'Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 69 },
      }];
      return { logs, findings };
    },
  },

  // ── J) Remote Access Tools Hunt ────────────────────────────────────────────
  remote_access_tools_hunt: {
    label: 'Remote Access Tools Hunt',
    description: 'Sucht nach RMM-/Remote-Access-Tools (AnyDesk, TeamViewer, ngrok …) — legitim oder Angreifer-Tooling.',
    category: 'Command and Control',
    mitre: 'T1219',
    dataSources: ['Sysmon', 'Wazuh', 'Zeek'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: remote_access_tools_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Running safe query: tasklist + netstat -ano + Get-Service'],
        [LOG_LEVEL.INFO, 'Matching against RMM/RAT signatures: AnyDesk, TeamViewer, ScreenConnect, Atera, NinjaRMM, ngrok'],
        [LOG_LEVEL.INFO, 'Checking processes and installed services for known tools'],
        [LOG_LEVEL.WARNING, 'Remote access tool detected: AnyDesk'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Remote access tool present (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Remote access tool present',
        description: 'RMM-/Remote-Access-Tool erkannt. Kann legitim sein — bei unerwartetem Einsatz Hinweis auf Hands-on-keyboard-Angriff.',
        severity: 'medium', confidence: pctToConfidence(73), mitreAttack: 'T1219',
        recommendation: ['Geschäftliche Berechtigung verifizieren', 'Ausgehende Verbindungen prüfen', 'Bei unautorisiert: Host isolieren (Genehmigung)'].join('\n'),
        context: { host, process: 'AnyDesk.exe', mitreTactic: 'Command and Control', mitreTechnique: 'T1219', source: 'Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 73 },
      }];
      return { logs, findings };
    },
  },

  // ── K) LSASS Access Hunt ───────────────────────────────────────────────────
  lsass_access_hunt: {
    label: 'LSASS Access Hunt',
    description: 'Sucht nach Prozessen, die auf lsass.exe zugreifen (Sysmon Event 10) — klassischer Credential-Dumping-Indikator (Mimikatz, comsvcs.dll).',
    category: 'Credential Access',
    mitre: 'T1003.001',
    dataSources: ['Sysmon', 'Wazuh', 'Windows Agent'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'critical',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: lsass_access_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Sysmon Event 10 (ProcessAccess) targeting lsass.exe'],
        [LOG_LEVEL.INFO, 'Filtering by GrantedAccess (0x1010 / 0x1410 / 0x143a)'],
        [LOG_LEVEL.INFO, 'Excluding known-good accessors (MsMpEng, wininit, csrss)'],
        [LOG_LEVEL.WARNING, 'Non-standard process accessed lsass.exe'],
        [LOG_LEVEL.INFO, 'SourceImage: C:\\Users\\public\\m.exe GrantedAccess: 0x1410'],
        [LOG_LEVEL.INFO, 'CallTrace contains UNKNOWN module (possible reflective DLL)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: LSASS credential access (Critical)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious LSASS access (possible credential dump)',
        description: 'Ein nicht-standardmäßiger Prozess hat lsass.exe mit Dump-typischer GrantedAccess geöffnet — starker Indikator für Credential Dumping (z.B. Mimikatz, comsvcs MiniDump).',
        severity: 'critical',
        confidence: pctToConfidence(88),
        mitreAttack: 'T1003.001',
        recommendation: [
          'SourceImage-Hash gegen Threat Intel prüfen',
          'CallTrace auf reflektierte/UNKNOWN-Module prüfen',
          'Betroffene Credentials als kompromittiert behandeln (Reset)',
          'Bei Bestätigung Host isolieren (Genehmigung)',
        ].join('\n'),
        context: {
          host, process: 'm.exe', parentProcess: 'cmd.exe', commandLine: 'ProcessAccess → lsass.exe (GrantedAccess 0x1410)',
          mitreTactic: 'Credential Access', mitreTechnique: 'T1003.001', source: 'Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 88,
        },
      }];
      return { logs, findings };
    },
  },

  // ── L) Lateral Movement Hunt (PsExec / SMB) ────────────────────────────────
  lateral_movement_hunt: {
    label: 'Lateral Movement Hunt (PsExec)',
    description: 'Erkennt PsExec-artige laterale Bewegung: Service-Erstellung über ADMIN$, PSEXESVC-Dienst und remote ausgeführte Befehle.',
    category: 'Lateral Movement',
    mitre: 'T1021.002',
    dataSources: ['Sysmon', 'Windows Security Log', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-02',
    defaultIp: '',
    riskLevel: 'high',
    build(session) {
      const host = session.targetHost || 'Windows-02';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: lateral_movement_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying service creation events (Sysmon 1 + Security 7045)'],
        [LOG_LEVEL.INFO, 'Matching PsExec signatures: PSEXESVC, \\\\*\\ADMIN$, -accepteula'],
        [LOG_LEVEL.INFO, 'Correlating with network logon type 3 (remote)'],
        [LOG_LEVEL.WARNING, 'PsExec-style service creation detected'],
        [LOG_LEVEL.INFO, 'Service: PSEXESVC → %SystemRoot%\\PSEXESVC.exe (remote 10.99.99.55)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Lateral movement via PsExec (High)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Lateral movement via PsExec/SMB',
        description: 'PSEXESVC-Dienst über ADMIN$-Freigabe von einem Remote-Host erstellt — typisches PsExec-Muster für laterale Bewegung.',
        severity: 'high',
        confidence: pctToConfidence(80),
        mitreAttack: 'T1021.002',
        recommendation: [
          'Quell-Host (10.99.99.55) als möglichen Brückenkopf untersuchen',
          'Verwendeten Account auf Kompromittierung prüfen',
          'ADMIN$/IPC$-Zugriffe im Zeitfenster korrelieren',
          'Bei Bestätigung beide Hosts isolieren (Genehmigung)',
        ].join('\n'),
        context: {
          host, user: 'NEXORA\\svc_admin', sourceIp: '10.99.99.55', process: 'PSEXESVC.exe',
          commandLine: 'Service create: PSEXESVC → %SystemRoot%\\PSEXESVC.exe',
          mitreTactic: 'Lateral Movement', mitreTechnique: 'T1021.002', source: 'Security Log / Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 80,
        },
      }];
      return { logs, findings };
    },
  },

  // ── M) BITS Jobs Hunt ──────────────────────────────────────────────────────
  bits_jobs_hunt: {
    label: 'BITS Jobs Hunt',
    description: 'Sucht nach missbräuchlichen BITS-Transfer-Jobs (bitsadmin / PowerShell Start-BitsTransfer) für Download/Persistenz/Exfiltration.',
    category: 'Defense Evasion',
    mitre: 'T1197',
    dataSources: ['Bits-Client Log', 'Sysmon', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'medium',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: bits_jobs_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Microsoft-Windows-Bits-Client/Operational (Event 59/60)'],
        [LOG_LEVEL.INFO, 'Matching bitsadmin /transfer + PowerShell Start-BitsTransfer'],
        [LOG_LEVEL.INFO, 'Checking remote URL reputation + target paths'],
        [LOG_LEVEL.WARNING, 'BITS job downloading to suspicious path detected'],
        [LOG_LEVEL.INFO, 'URL: http://185.untrusted.example/x.exe → %APPDATA%\\x.exe'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Suspicious BITS transfer (Medium)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Suspicious BITS transfer job',
        description: 'BITS-Job lädt eine ausführbare Datei von einer externen URL in ein Benutzerverzeichnis — LOLBin-Technik zur Umgehung von Anwendungs-Allowlists.',
        severity: 'medium',
        confidence: pctToConfidence(72),
        mitreAttack: 'T1197',
        recommendation: [
          'Remote-URL gegen Threat Intel prüfen',
          'Heruntergeladene Binary-Hash bewerten',
          'Offene BITS-Jobs auflisten (bitsadmin /list /allusers)',
          'Bei Bestätigung Job abbrechen + Binary entfernen (Genehmigung)',
        ].join('\n'),
        context: {
          host, process: 'svchost.exe (BITS)', commandLine: 'bitsadmin /transfer → http://185.untrusted.example/x.exe → %APPDATA%\\x.exe',
          destinationIp: '', mitreTactic: 'Defense Evasion', mitreTechnique: 'T1197', source: 'Bits-Client Log', verdict: 'suspicious', status: 'new', confidencePct: 72,
        },
      }];
      return { logs, findings };
    },
  },

  // ── N) WMI Persistence Hunt ────────────────────────────────────────────────
  wmi_persistence_hunt: {
    label: 'WMI Persistence Hunt',
    description: 'Sucht nach WMI-Event-Subscription-Persistenz: __EventFilter, CommandLineEventConsumer und FilterToConsumerBinding (Sysmon 19/20/21).',
    category: 'Persistence',
    mitre: 'T1546.003',
    dataSources: ['Sysmon', 'WMI-Activity Log', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'high',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: wmi_persistence_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Sysmon Event 19/20/21 (WMI Filter/Consumer/Binding)'],
        [LOG_LEVEL.INFO, 'Enumerating __EventFilter + CommandLineEventConsumer'],
        [LOG_LEVEL.INFO, 'Checking consumer command lines for script/encoded payloads'],
        [LOG_LEVEL.WARNING, 'WMI event consumer with command execution detected'],
        [LOG_LEVEL.INFO, 'Consumer: ActiveScriptEventConsumer → powershell -w hidden -enc ...'],
        [LOG_LEVEL.SUCCESS, 'Finding created: WMI event subscription persistence (High)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'WMI event subscription persistence',
        description: 'Ein WMI-EventConsumer ist mit einem EventFilter verknüpft und führt bei einem Trigger Code aus — dateilose Persistenz-Technik (T1546.003).',
        severity: 'high',
        confidence: pctToConfidence(79),
        mitreAttack: 'T1546.003',
        recommendation: [
          'FilterToConsumerBinding prüfen (Get-WmiObject -Namespace root\\subscription)',
          'Consumer-CommandLine/Skript gegen Threat Intel',
          'Trigger-Filter (__EventFilter Query) bewerten',
          'Bei Bestätigung Subscription entfernen (Genehmigung)',
        ].join('\n'),
        context: {
          host, process: 'WmiPrvSE.exe', commandLine: 'ActiveScriptEventConsumer → powershell -w hidden -enc ...',
          mitreTactic: 'Persistence', mitreTechnique: 'T1546.003', source: 'Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 79,
        },
      }];
      return { logs, findings };
    },
  },

  // ── O) Token Theft / Impersonation Hunt ────────────────────────────────────
  token_theft_hunt: {
    label: 'Token Theft Hunt',
    description: 'Sucht nach Access-Token-Diebstahl/-Impersonation: Prozesse, die unter einem fremden (erhöhten) Token laufen — Logon Type 9 (NewCredentials), SeImpersonate-/SeDebugPrivilege, DuplicateTokenEx.',
    category: 'Privilege Escalation',
    mitre: 'T1134.001',
    dataSources: ['Sysmon', 'Windows Security Log', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'high',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: token_theft_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Security 4624 (Logon Type 9 / NewCredentials) + 4672 (special privileges)'],
        [LOG_LEVEL.INFO, 'Correlating with Sysmon 1 process creation under mismatched user/LogonId'],
        [LOG_LEVEL.INFO, 'Checking for SeImpersonatePrivilege / SeDebugPrivilege use'],
        [LOG_LEVEL.WARNING, 'Process running under impersonated token detected'],
        [LOG_LEVEL.INFO, 'Process: cmd.exe — SYSTEM token from non-SYSTEM parent (LogonId mismatch)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Access token impersonation (High)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Access token theft / impersonation',
        description: 'Ein Prozess läuft unter einem fremden, vermutlich erhöhten Token — typisch für Token-Diebstahl/Impersonation zur Rechteausweitung (z.B. nach Ausnutzung eines SeImpersonate-Dienstes).',
        severity: 'high',
        confidence: pctToConfidence(76),
        mitreAttack: 'T1134.001',
        recommendation: [
          'Eltern-/Kindprozess-Kette und LogonId prüfen',
          'Beteiligten Account auf Kompromittierung prüfen',
          'Privilegierte Sessions im Zeitfenster korrelieren',
          'Bei Bestätigung Host isolieren (Genehmigung)',
        ].join('\n'),
        context: {
          host, user: 'NEXORA\\svc_task', process: 'cmd.exe', parentProcess: 'spoolsv.exe',
          commandLine: 'Logon Type 9 (NewCredentials) → SYSTEM token impersonation',
          mitreTactic: 'Privilege Escalation', mitreTechnique: 'T1134.001', source: 'Security Log / Sysmon', verdict: 'suspicious', status: 'new', confidencePct: 76,
        },
      }];
      return { logs, findings };
    },
  },

  // ── P) AS-REP Roasting Hunt ────────────────────────────────────────────────
  asrep_roasting_hunt: {
    label: 'AS-REP Roasting Hunt',
    description: 'Erkennt AS-REP-Roasting: Kerberos-AS-REQ ohne Pre-Authentication (Security 4768) für Konten mit deaktivierter Pre-Auth, oft RC4 (0x17) — der Angreifer extrahiert offline crackbare AS-REP-Hashes.',
    category: 'Credential Access',
    mitre: 'T1558.004',
    dataSources: ['Windows Security Log (DC)', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'DC01',
    defaultIp: '10.99.99.10',
    riskLevel: 'high',
    build(session) {
      const host = session.targetHost || 'DC01';
      const ip   = session.context?.sourceIp || '10.99.99.55';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: asrep_roasting_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying DC Security 4768 (Kerberos AS-REQ)'],
        [LOG_LEVEL.INFO, 'Filtering Pre-Authentication Type 0 (no pre-auth)'],
        [LOG_LEVEL.INFO, 'Flagging Ticket Encryption Type 0x17 (RC4-HMAC)'],
        [LOG_LEVEL.WARNING, 'AS-REQ without pre-authentication detected'],
        [LOG_LEVEL.INFO, `Account: svc_legacy  EncType: 0x17  Client: ${ip}`],
        [LOG_LEVEL.SUCCESS, 'Finding created: AS-REP roasting attempt (High)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'AS-REP roasting attempt',
        description: 'Kerberos-AS-REQ ohne Pre-Authentication für ein Konto mit deaktivierter Pre-Auth, RC4-verschlüsselt — der zurückgegebene AS-REP-Hash lässt sich offline cracken.',
        severity: 'high',
        confidence: pctToConfidence(77),
        mitreAttack: 'T1558.004',
        recommendation: [
          'Pre-Authentication für das betroffene Konto wieder aktivieren',
          'Starkes Passwort erzwingen / Konto-Reset',
          'Quell-Client untersuchen',
          'RC4 für Kerberos deaktivieren (AES erzwingen)',
        ].join('\n'),
        context: {
          host, user: 'NEXORA\\svc_legacy', sourceIp: ip,
          commandLine: 'Kerberos AS-REQ PreAuthType=0 EncType=0x17 (RC4)',
          mitreTactic: 'Credential Access', mitreTechnique: 'T1558.004', source: 'Security Log (DC)', verdict: 'suspicious', status: 'new', confidencePct: 77,
        },
      }];
      return { logs, findings };
    },
  },

  // ── Q) Shadow Copy Deletion Hunt (Ransomware-Vorstufe) ─────────────────────
  shadow_copy_deletion_hunt: {
    label: 'Shadow Copy Deletion Hunt',
    description: 'Erkennt Löschen von Volume Shadow Copies / Recovery-Sabotage (vssadmin delete shadows, wmic shadowcopy delete, bcdedit recoveryenabled no, wbadmin delete) — klassische Ransomware-Vorstufe.',
    category: 'Impact',
    mitre: 'T1490',
    dataSources: ['Sysmon', 'Windows Security Log', 'Wazuh'],
    targetType: 'host',
    defaultTarget: 'Windows-01',
    defaultIp: '',
    riskLevel: 'critical',
    build(session) {
      const host = session.targetHost || 'Windows-01';
      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, 'Hunt Type: shadow_copy_deletion_hunt'],
        [LOG_LEVEL.INFO, `Target: ${host}`],
        [LOG_LEVEL.INFO, 'Querying Sysmon 1 (process create) for recovery-sabotage tooling'],
        [LOG_LEVEL.INFO, 'Matching vssadmin / wmic / bcdedit / wbadmin delete patterns'],
        [LOG_LEVEL.WARNING, 'Shadow copy deletion command detected'],
        [LOG_LEVEL.INFO, 'Command: vssadmin.exe Delete Shadows /All /Quiet'],
        [LOG_LEVEL.INFO, 'Parent: cmd.exe (non-interactive, automated)'],
        [LOG_LEVEL.SUCCESS, 'Finding created: Shadow copy deletion / ransomware precursor (Critical)'],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];
      const findings = [{
        title: 'Shadow copy deletion (ransomware precursor)',
        description: 'Es wurde ein Befehl zum Löschen der Volume Shadow Copies bzw. zur Deaktivierung der Systemwiederherstellung ausgeführt — verhindert die Wiederherstellung und geht einer Ransomware-Verschlüsselung typischerweise unmittelbar voraus.',
        severity: 'critical',
        confidence: pctToConfidence(90),
        mitreAttack: 'T1490',
        recommendation: [
          'SOFORT: Host als möglichen Ransomware-Fall behandeln',
          'Auslösenden Prozess + Parent-Kette identifizieren',
          'Host isolieren, bevor die Verschlüsselung startet (Genehmigung)',
          'Offline-Backups prüfen und sichern',
        ].join('\n'),
        context: {
          host, process: 'vssadmin.exe', parentProcess: 'cmd.exe',
          commandLine: 'vssadmin.exe Delete Shadows /All /Quiet',
          mitreTactic: 'Impact', mitreTechnique: 'T1490', source: 'Sysmon', verdict: 'malicious', status: 'new', confidencePct: 90,
        },
      }];
      return { logs, findings };
    },
  },

  // ── Erweiterter Katalog (MITRE-ATT&CK-Breitenabdeckung ≥ 50 %) ─────────────
  // Definiert in huntTypeExtended.js über den DRY-Factory-Bausatz. Gleiche Form
  // (label/description/category/mitre/dataSources/riskLevel/build), damit Runner,
  // Katalog und UI unverändert funktionieren.
  ...EXTENDED_HUNT_TYPES,
};

const HUNT_TYPE_KEYS = Object.keys(HUNT_TYPES);

function getHuntType(key) {
  return HUNT_TYPES[key] || null;
}

/** Katalog der vorgefertigten Hunts (Metadaten, ohne build-Funktion) — für die UI. */
function getCatalog() {
  return HUNT_TYPE_KEYS.map((key) => {
    const t = HUNT_TYPES[key];
    return {
      key,
      label: t.label,
      description: t.description || '',
      category: t.category || '',
      mitre: t.mitre || '',
      dataSources: t.dataSources || [],
      targetType: t.targetType || 'host',
      defaultTarget: t.defaultTarget || '',
      defaultIp: t.defaultIp || '',
      riskLevel: t.riskLevel || 'low',
    };
  });
}

module.exports = { HUNT_TYPES, HUNT_TYPE_KEYS, getHuntType, getCatalog };
