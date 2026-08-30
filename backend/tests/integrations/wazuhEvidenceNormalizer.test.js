'use strict';

const { normalizeWazuhEvidence, extractRaw } = require('../../src/integrations/adapters/wazuh/wazuhEvidenceNormalizer');

const RAW = {
  rule: { id: '87702', level: 10, description: 'Multiple pfSense firewall blocks events from same source.',
          mitre: { id: ['T1190'], tactic: ['Initial Access'] }, groups: ['pfsense', 'firewall'] },
  agent: { id: '003', name: 'OPNsense', ip: '192.168.240.41' },
  data: { srcip: '192.168.240.109', dstip: '224.0.0.7', dstport: '5353', protocol: 'UDP', action: 'block' },
  location: '/var/log/filter.log', full_log: 'block in on igb0 ... 192.168.240.109 -> 224.0.0.7',
};

const wazuhTicket = (over = {}) => ({
  id: 't1', source: 'wazuh', offenseId: 'wazuh:rule:87702:agent:003',
  title: 'Multiple pfSense firewall blocks events from same source.',
  priority: 'high', srcIp: '192.168.240.109', dstIp: '224.0.0.7', mitre: 'T1190',
  description: 'Wiederholte Firewall-Blocks von derselben Quelle.',
  createdAt: '2026-06-06T22:44:00.000Z', updatedAt: '2026-06-07T08:30:00.000Z',
  logs: `Agent: OPNsense (id 003)\nRule 87702 — Level 10\n\nRaw Alert (JSON):\n${JSON.stringify(RAW)}`,
  ...over,
});

describe('wazuhEvidenceNormalizer', () => {
  test('extractRaw parst das Roh-JSON aus dem logs-Feld', () => {
    const raw = extractRaw(wazuhTicket().logs);
    expect(raw.rule.id).toBe('87702');
    expect(raw.data.dstip).toBe('224.0.0.7');
  });

  test('füllt Evidence aus dem Roh-Event (Firewall-Fall)', () => {
    const e = normalizeWazuhEvidence(wazuhTicket());
    expect(e.detection.ruleId).toBe('87702');
    expect(e.detection.ruleName).toMatch(/pfSense/);
    expect(e.detection.severity).toBe('High');
    expect(e.source.ip).toBe('192.168.240.109');
    expect(e.source.host).toBe('OPNsense');
    expect(e.destination.ip).toBe('224.0.0.7');
    expect(e.destination.port).toBe(5353);
    expect(e.network.protocol).toBe('UDP');
    expect(e.network.action).toBe('block');
    expect(e.metadata.mitreTactic).toBe('Initial Access');
    expect(e.metadata.agentId).toBe('003');
    expect(e.metadata.agentName).toBe('OPNsense');
    expect(e.raw).toBeTruthy();
  });

  test('Fallback ohne Roh-Event: Rule-/Agent-ID aus offenseId + flache Felder', () => {
    const e = normalizeWazuhEvidence(wazuhTicket({ logs: 'kein roh-event hier' }));
    expect(e.detection.ruleId).toBe('87702');   // aus offenseId abgeleitet
    expect(e.metadata.agentId).toBe('003');
    expect(e.source.ip).toBe('192.168.240.109');  // flaches Feld
    expect(e.destination.ip).toBe('224.0.0.7');
    expect(e.raw).toBeUndefined();
  });

  test('robust bei kaputtem/abgeschnittenem JSON → Fallback statt Crash', () => {
    const e = normalizeWazuhEvidence(wazuhTicket({ logs: 'Raw Alert (JSON):\n{ "rule": { "id": "877' }));
    expect(e.detection.ruleId).toBe('87702');   // fällt auf offenseId zurück
    expect(e.raw).toBeUndefined();
  });

  test('Firewall-Event hat kein process-Feld → type network', () => {
    const e = normalizeWazuhEvidence(wazuhTicket());
    expect(e.type).toBe('network');
    expect(e.process).toBeUndefined();
  });
});

// ── Windows Process Creation ───────────────────────────────────────────────
const procTicket = (eventdata) => ({
  id: 'p1', source: 'wazuh', offenseId: 'wazuh:rule:92052:agent:001', title: 'Process creation',
  priority: 'low', createdAt: '2026-06-07T10:00:00Z', updatedAt: '2026-06-07T10:00:00Z',
  logs: `Raw Alert (JSON):\n${JSON.stringify({
    rule: { id: '92052', level: 3, description: 'Sysmon - Event 1: Process creation' },
    agent: { id: '001', name: 'WindowsClient' }, location: 'EventChannel',
    data: { win: { eventdata } },
  })}`,
});

describe('wazuhEvidenceNormalizer — Process Creation', () => {
  test('Sysmon EventID 1: Image/CommandLine/Parent/User/LogonId/Hashes', () => {
    const e = normalizeWazuhEvidence(procTicket({
      image: 'C:\\\\Windows\\\\System32\\\\cmd.exe', commandLine: 'cmd /c whoami',
      parentImage: 'C:\\\\Windows\\\\explorer.exe', parentCommandLine: 'explorer.exe',
      user: 'CORP\\\\jdoe', logonId: '0x3e7', processId: '4242',
      hashes: 'SHA256=ABC123', integrityLevel: 'High', currentDirectory: 'C:\\\\Users\\\\jdoe',
    }));
    expect(e.type).toBe('process');
    expect(e.process.image).toMatch(/cmd\.exe/);
    expect(e.process.commandLine).toBe('cmd /c whoami');
    expect(e.process.parentImage).toMatch(/explorer\.exe/);
    expect(e.process.logonId).toBe('0x3e7');
    expect(e.process.hashes).toMatch(/SHA256/);
    expect(e.process.integrityLevel).toBe('High');
    expect(e.source.user).toBe('CORP\\\\jdoe'); // Source-User aus win.eventdata
  });

  test('Security 4688: newProcessName/subjectUserName/subjectLogonId/parentProcessName', () => {
    const e = normalizeWazuhEvidence(procTicket({
      newProcessName: 'C:\\\\Windows\\\\System32\\\\net.exe', commandLine: 'net user',
      subjectUserName: 'admin', subjectLogonId: '0x3e7',
      parentProcessName: 'C:\\\\Windows\\\\System32\\\\cmd.exe', tokenElevationType: '%%1937', newProcessId: '0x1a2',
    }));
    expect(e.type).toBe('process');
    expect(e.process.image).toMatch(/net\.exe/);
    expect(e.process.user).toBe('admin');
    expect(e.process.logonId).toBe('0x3e7');
    expect(e.process.parentImage).toMatch(/cmd\.exe/);
    expect(e.process.integrityLevel).toBe('%%1937');
    expect(e.process.processId).toBe('0x1a2');
  });

  test('PowerShell ScriptBlock (Event 4104, Rule 91809): scriptBlockText → process.commandLine', () => {
    const e = normalizeWazuhEvidence(procTicket({
      scriptBlockText: '$d=[Convert]::FromBase64String("ZQBjAGgAbwA=");iex([Text.Encoding]::UTF8.GetString($d))',
    }));
    expect(e.type).toBe('process');
    expect(e.process).toBeDefined();
    expect(e.process.commandLine).toContain('FromBase64String'); // Skript im Deck sichtbar
  });
});

describe('wazuhEvidenceNormalizer — Sysmon Network (3) / DNS (22)', () => {
  test('Event 3 (Network Connection): Destination/Protocol/Process aus win.eventdata', () => {
    const e = normalizeWazuhEvidence(procTicket({
      image: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\chrome.exe', user: 'CORP\\\\jdoe',
      protocol: 'tcp', initiated: 'true', sourceIp: '192.168.241.102', sourcePort: '51000',
      destinationIp: '140.82.121.4', destinationPort: '443', destinationHostname: 'github.com',
    }));
    expect(e.type).toBe('network');           // kein commandLine → network statt process
    expect(e.destination.ip).toBe('140.82.121.4');
    expect(e.destination.port).toBe(443);
    expect(e.destination.fqdn).toBe('github.com');
    expect(e.network.protocol).toBe('tcp');
    expect(e.network.direction).toBe('outbound');
    expect(e.network.action).toMatch(/initiated/);  // Sysmon = Verbindung fand statt (kein 'block')
    expect(e.source.ip).toBe('192.168.241.102');
    expect(e.process.image).toMatch(/chrome\.exe/); // welcher Prozess die Verbindung aufbaute
  });

  test('Event 22 (DNS Query): query/answers + type dns', () => {
    const e = normalizeWazuhEvidence(procTicket({
      image: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\chrome.exe',
      queryName: 'example.com', queryResults: 'type: 5 example.com;::ffff:93.184.216.34;', queryStatus: '0',
    }));
    expect(e.type).toBe('dns');
    expect(e.dns.query).toBe('example.com');
    expect(e.dns.answers).toMatch(/93\.184\.216\.34/);
    expect(e.destination.fqdn).toBe('example.com'); // FQDN aus DNS-Query
  });

  test('Event 11 (FileCreate): erzeugte Datei + verantwortlicher Prozess', () => {
    const e = normalizeWazuhEvidence(procTicket({
      image: 'C:\\\\Windows\\\\SysWOW64\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe',
      targetFilename: 'C:\\\\Windows\\\\evil.exe', hashes: 'SHA256=DEADBEEF', user: 'CORP\\\\admin',
    }));
    expect(e.type).toBe('process');
    expect(e.file.name).toMatch(/evil\.exe/);
    expect(e.file.hashes).toMatch(/SHA256/);
    expect(e.process.image).toMatch(/powershell\.exe/); // Dropper-Prozess
  });
});

describe('wazuhEvidenceNormalizer — Windows EventChannel (win.system, leere eventdata)', () => {
  // WMI-Activity & viele Windows-Regeln liefern Inhalte in win.system, NICHT in eventdata.
  const sysTicket = (system) => ({
    id: 'w-sys', source: 'wazuh', offenseId: 'wazuh:rule:92654:agent:009',
    title: 'WMI query for System Information Discovery', priority: 'medium',
    createdAt: '2026-06-14T14:54:27Z', updatedAt: '2026-06-16T19:36:35Z',
    logs: `Raw Alert (JSON):\n${JSON.stringify({
      rule: { id: '92654', level: 5, description: 'WMI query', mitre: { id: ['T1047'], tactic: ['Execution'] } },
      agent: { id: '009', name: 'DC01' },
      data: { win: { system, eventdata: {} } },
    })}`,
  });

  test('surfaced windowsEvent (Provider/EventID/Channel/Message) statt leerem Deck', () => {
    const e = normalizeWazuhEvidence(sysTicket({
      providerName: 'Microsoft-Windows-WMI-Activity', eventID: '11', channel: 'Microsoft-Windows-WMI-Activity/Operational',
      computer: 'DC01.nexora.example', message: 'Es wurde eine WMI-Abfrage ausgeführt: SELECT * FROM Win32_OperatingSystem',
    }));
    expect(e.windowsEvent).toBeTruthy();
    expect(e.windowsEvent.eventId).toBe('11');
    expect(e.windowsEvent.provider).toBe('Microsoft-Windows-WMI-Activity');
    expect(e.windowsEvent.message).toMatch(/Win32_OperatingSystem/);
    expect(e.type).toBe('alert');                          // kein Flow/Prozess → alert
    expect(e.detection.description).toMatch(/WMI query/);   // rule.description; volle Message in windowsEvent.message
    expect(e.source.host).toBe('DC01');                    // agent.name gewinnt
    expect(e.metadata.logSource).toMatch(/WMI-Activity/);  // Channel als logSource-Fallback
  });

  test('kein win.system → kein windowsEvent (keine Fake-Daten)', () => {
    const e = normalizeWazuhEvidence(sysTicket({}));
    expect(e.windowsEvent).toBeUndefined();
  });
});

// ── Cowrie-Honeypot ────────────────────────────────────────────────────────
const cowrieTicket = (data) => ({
  id: 'c1', source: 'wazuh', offenseId: 'wazuh:rule:100203:agent:013', title: 'Honeypot-Befehl',
  priority: 'high', createdAt: '2026-06-23T21:00:00Z', updatedAt: '2026-06-23T21:00:00Z',
  logs: `Raw Alert (JSON):\n${JSON.stringify({
    rule: { id: '100203', level: 12, description: 'Honeypot: Befehl ausgefuehrt', groups: ['cowrie', 'honeypot'] },
    agent: { id: '013', name: 'ubuntu' }, location: '/home/cowrie/cowrie/var/log/cowrie/cowrie.json',
    data,
  })}`,
});

describe('wazuhEvidenceNormalizer — Cowrie Honeypot', () => {
  test('command.input: src_ip = echter Angreifer (Quelle), input = Command, type=process', () => {
    const e = normalizeWazuhEvidence(cowrieTicket({
      eventid: 'cowrie.command.input', input: 'uname -s -v -n -r -m',
      src_ip: '176.65.139.88', session: 'fd2f441e837a', protocol: 'ssh',
    }));
    expect(e.source.ip).toBe('176.65.139.88');                 // nicht die Agent-/Tunnel-IP
    expect(e.process.commandLine).toBe('uname -s -v -n -r -m'); // → Commands-Tab
    expect(e.network.protocol).toBe('ssh');
    expect(e.type).toBe('process');
  });

  test('session.connect: src/dst-IP + Ports gemappt (wo Cowrie sie liefert)', () => {
    const e = normalizeWazuhEvidence(cowrieTicket({
      eventid: 'cowrie.session.connect', src_ip: '1.2.3.4', src_port: '54321',
      dst_ip: '10.99.99.80', dst_port: '2222', protocol: 'ssh',
    }));
    expect(e.source.ip).toBe('1.2.3.4');
    expect(e.source.port).toBe(54321);
    expect(e.destination.ip).toBe('10.99.99.80');
    expect(e.destination.port).toBe(2222);
  });
});
