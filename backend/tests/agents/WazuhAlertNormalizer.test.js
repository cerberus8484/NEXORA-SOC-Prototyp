'use strict';

const { normalize } = require('../../src/agents/bundle/WazuhAlertNormalizer');

// ── Fixture: Regel-19011 (SSH MACs) — echter FP-Fall aus der Praxis ──────────
const RULE_19011 = {
  id: 'abc123',
  timestamp: '2026-06-09T08:00:00.000Z',
  rule: {
    id: '19011',
    level: 9,
    description: 'SSHD weak MAC algorithms configured',
    groups: ['sshd', 'configuration'],
    mitre: { id: [], tactic: ['Defense Evasion'], technique: [] },
  },
  agent: { id: '000', name: 'wazuh-server', ip: '' },
  manager: { name: 'wazuh-manager' },
  decoder: { name: 'sshd' },
  location: '/etc/ssh/sshd_config',
  full_log: 'MACs hmac-sha1,hmac-md5',
  data: {},
};

// ── Fixture: Sysmon PowerShell (Process Creation) ────────────────────────────
const SYSMON_POWERSHELL = {
  id: 'def456',
  timestamp: '2026-06-09T09:30:00.000Z',
  rule: {
    id: '92200',
    level: 12,
    description: 'Sysmon - Process Creation (Event 1)',
    groups: ['sysmon', 'windows'],
    mitre: { id: ['T1059.001'], tactic: ['Execution'], technique: ['PowerShell'] },
  },
  agent: { id: '007', name: 'WIN-CLIENT-01', ip: '192.168.240.55' },
  manager: { name: 'wazuh-manager' },
  decoder: { name: 'windows_decoders' },
  location: 'EventChannel',
  full_log: 'EventID 1 powershell.exe',
  data: {
    win: {
      eventdata: {
        image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        commandLine: 'powershell.exe -enc UwB0AGEAcgB0AC0AUAByAG8AYwBlAHMAcw==',
        parentImage: 'C:\\Windows\\System32\\cmd.exe',
        user: 'DOMAIN\\jsmith',
        processId: '4528',
        parentProcessId: '3200',
        integrityLevel: 'High',
        hashes: 'SHA256=abc123def456',
      },
    },
    srcip: '192.168.240.55',
  },
};

// ── Fixture: Netzwerk-Event (OPNsense Firewall) ──────────────────────────────
const NETWORK_EVENT = {
  id: 'ghi789',
  timestamp: '2026-06-09T10:00:00.000Z',
  rule: { id: '4200', level: 5, description: 'Firewall block event', groups: ['firewall'], mitre: {} },
  agent: { id: '003', name: 'OPNsense-fw', ip: '192.168.240.1' },
  manager: { name: 'wazuh-manager' },
  decoder: { name: 'pf' },
  location: 'firewall',
  full_log: 'block in on em0 from 203.0.113.55 to 192.168.240.72',
  data: {
    srcip: '203.0.113.55',
    dstip: '192.168.240.72',
    dstport: '22',
    proto: 'tcp',
    action: 'block',
    interface: 'em0',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

describe('WazuhAlertNormalizer', () => {

  describe('null / ungültige Eingabe', () => {
    test('null → available: false', () => {
      expect(normalize(null).available).toBe(false);
    });
    test('undefined → available: false', () => {
      expect(normalize(undefined).available).toBe(false);
    });
    test('string → available: false', () => {
      expect(normalize('not-an-object').available).toBe(false);
    });
    test('leeres Objekt → available: true, meiste Felder undefined', () => {
      const r = normalize({});
      expect(r.available).toBe(true);
      expect(r.ruleId).toBeUndefined();
      expect(r.raw).toEqual({});
    });
  });

  describe('Regel-19011 (SSH MACs FP-Fall)', () => {
    let r;
    beforeEach(() => { r = normalize(RULE_19011); });

    test('available: true', () => expect(r.available).toBe(true));
    test('ruleId = "19011"',  () => expect(r.ruleId).toBe('19011'));
    test('ruleLevel = 9',     () => expect(r.ruleLevel).toBe(9));
    test('agentName = wazuh-server', () => expect(r.agentName).toBe('wazuh-server'));
    test('agentIp = undefined (leer)', () => expect(r.agentIp).toBeUndefined());
    test('fullLog vorhanden', () => expect(r.fullLog).toContain('hmac'));
    test('location korrekt',  () => expect(r.location).toBe('/etc/ssh/sshd_config'));
    test('ruleGroups enthält sshd', () => expect(r.ruleGroups).toContain('sshd'));
    test('raw erhalten',      () => expect(r.raw).toBe(RULE_19011));

    test('missingFields enthält agent.ip', () =>
      expect(r.missingFields).toContain('agent.ip'));
    test('missingFields enthält process.commandLine', () =>
      expect(r.missingFields).toContain('process.commandLine'));
  });

  describe('Sysmon PowerShell (Process Creation)', () => {
    let r;
    beforeEach(() => { r = normalize(SYSMON_POWERSHELL); });

    test('available: true', () => expect(r.available).toBe(true));
    test('agentIp korrekt',  () => expect(r.agentIp).toBe('192.168.240.55'));
    test('mitreTechniques',  () => expect(r.mitreTechniques).toContain('T1059.001'));
    test('mitreTactics',     () => expect(r.mitreTactics).toContain('Execution'));

    test('process.name enthält powershell.exe', () =>
      expect(r.process?.name).toContain('powershell.exe'));
    test('process.commandLine enthält -enc', () =>
      expect(r.process?.commandLine).toContain('-enc'));
    test('process.parentName enthält cmd.exe', () =>
      expect(r.process?.parentName).toContain('cmd.exe'));
    test('process.user korrekt', () =>
      expect(r.process?.user).toBe('DOMAIN\\jsmith'));
    test('process.hash vorhanden', () =>
      expect(r.process?.hash).toContain('SHA256'));

    test('network.srcIp aus data.srcip', () =>
      expect(r.network?.srcIp).toBe('192.168.240.55'));
  });

  describe('Netzwerk-Event (Firewall)', () => {
    let r;
    beforeEach(() => { r = normalize(NETWORK_EVENT); });

    test('network.srcIp korrekt', () => expect(r.network?.srcIp).toBe('203.0.113.55'));
    test('network.dstIp korrekt', () => expect(r.network?.dstIp).toBe('192.168.240.72'));
    test('network.dstPort korrekt', () => expect(r.network?.dstPort).toBe('22'));
    test('network.protocol korrekt', () => expect(r.network?.protocol).toBe('tcp'));
    test('network.action = block', () => expect(r.network?.action).toBe('block'));
    test('network.interface = em0', () => expect(r.network?.interface).toBe('em0'));
    test('kein process-Objekt', () => expect(r.process).toBeUndefined());
  });

  describe('raw nie verloren', () => {
    test('raw ist immer das originale Objekt', () => {
      const input = { rule: { id: '1', level: 3 }, agent: {} };
      expect(normalize(input).raw).toBe(input);
    });
  });

  describe('VirusTotal (Threat Intel)', () => {
    const VT_ALERT = {
      id: 'vt1',
      rule: { id: '87105', level: 12, description: 'VirusTotal: file is malicious', groups: ['virustotal'], mitre: {} },
      agent: { id: '004', name: 'WEC01', ip: '10.99.99.11' },
      decoder: { name: 'json' },
      location: 'virustotal',
      full_log: 'EICAR malicious',
      data: {
        virustotal: {
          found: '1', malicious: '60', positives: '60', total: '70',
          permalink: 'https://www.virustotal.com/gui/file/abc',
          source: { file: 'C:\\fim-test\\eicar.com', md5: '44d88612fea8a8f36de82e1278abb02f' },
        },
      },
    };

    test('threatIntel.malicious wird extrahiert', () => {
      expect(normalize(VT_ALERT).threatIntel?.malicious).toBe(60);
    });
    test('threatIntel.total + file + source gesetzt', () => {
      const ti = normalize(VT_ALERT).threatIntel;
      expect(ti.total).toBe(70);
      expect(ti.file).toBe('C:\\fim-test\\eicar.com');
      expect(ti.source).toBe('VirusTotal');
    });
    test('kein virustotal-Block → threatIntel undefined', () => {
      expect(normalize({ rule: { id: '1', level: 3 }, agent: {}, data: {} }).threatIntel).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Erweiterte Entity-Extraktion (Hash/Signatur, User-SID, File, Registry)
// ─────────────────────────────────────────────────────────────────────────────
describe('WazuhAlertNormalizer — erweiterte Entities', () => {
  describe('Sysmon Process Create (Event 1) — Hash/Signatur/Publisher', () => {
    const ALERT = {
      id: 'p1', rule: { id: '92200', level: 12, description: 'Sysmon Process', groups: ['sysmon'], mitre: {} },
      agent: { id: '007', name: 'WIN01', ip: '10.99.99.50' }, decoder: { name: 'windows' },
      data: { win: { eventdata: {
        image: 'C:\Temp\mal.exe', commandLine: 'mal.exe -run', parentImage: 'C:\Windows\explorer.exe',
        user: 'NEXORA\admin', processId: '5000', parentProcessId: '900',
        hashes: 'MD5=aaa,SHA256=ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
        signed: 'false', signature: 'Unsigned', originalFileName: 'evil.exe', company: 'n/a',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('hashSha256 aus hashes-String geparst (uppercase)', () =>
      expect(r.process?.hashSha256).toBe('ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'));
    test('signed', () => expect(r.process?.signed).toBe('false'));
    test('publisher aus signature', () => expect(r.process?.publisher).toBe('Unsigned'));
    test('originalFileName', () => expect(r.process?.originalFileName).toBe('evil.exe'));
  });

  describe('Windows Auth (Event 4625) — SID/Domain/Privilege', () => {
    const ALERT = {
      id: 'a1', rule: { id: '60122', level: 5, description: 'Logon failure', groups: ['authentication'], mitre: {} },
      agent: { id: '004', name: 'DC01', ip: '10.99.99.10' }, decoder: { name: 'windows' },
      data: { win: { eventdata: {
        targetUserName: 'svc_backup', targetDomainName: 'NEXORA', logonType: '3',
        subjectUserSid: 'S-1-5-21-1004', targetUserSid: 'S-1-5-21-2000',
        status: '0xC000006D', privilegeList: 'SeDebugPrivilege',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('auth.user', () => expect(r.auth?.user).toBe('svc_backup'));
    test('auth.domain', () => expect(r.auth?.domain).toBe('NEXORA'));
    test('auth.sid', () => expect(r.auth?.sid).toBe('S-1-5-21-1004'));
    test('auth.privilege', () => expect(r.auth?.privilege).toBe('SeDebugPrivilege'));
    test('auth.logonType', () => expect(r.auth?.logonType).toBe('3'));
  });

  describe('Sysmon FileCreate (Event 11) — File-Entity', () => {
    const ALERT = {
      id: 'f1', rule: { id: '92213', level: 7, description: 'Sysmon FileCreate', groups: ['sysmon'], mitre: {} },
      agent: { id: '007', name: 'WIN01', ip: '10.99.99.50' }, decoder: { name: 'windows' },
      data: { win: { eventdata: {
        targetFilename: 'C:\\Users\\jsmith\\AppData\\Local\\Temp\\dropper.dll',
        hashes: 'SHA256=1111111111111111111111111111111111111111111111111111111111111111',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('file.name', () => expect(r.file?.name).toBe('dropper.dll'));
    test('file.directory', () => expect(r.file?.directory).toBe('C:\\Users\\jsmith\\AppData\\Local\\Temp'));
    test('file.hashSha256 aus Sysmon hashes', () =>
      expect(r.file?.hashSha256).toBe('1111111111111111111111111111111111111111111111111111111111111111'));
  });

  describe('FIM/Syscheck — File-Entity aus syscheck', () => {
    const ALERT = {
      id: 's1', rule: { id: '550', level: 7, description: 'Integrity checksum changed', groups: ['syscheck'], mitre: {} },
      agent: { id: '012', name: 'web01', ip: '10.99.99.72' }, decoder: { name: 'syscheck' },
      syscheck: { path: '/var/www/html/shell.php', event: 'added', sha256_after: '2222222222222222222222222222222222222222222222222222222222222222', size_after: '1024' },
      data: {},
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('file.path aus syscheck', () => expect(r.file?.path).toBe('/var/www/html/shell.php'));
    test('file.name', () => expect(r.file?.name).toBe('shell.php'));
    test('file.directory (Unix)', () => expect(r.file?.directory).toBe('/var/www/html'));
    test('file.hashSha256 aus sha256_after', () =>
      expect(r.file?.hashSha256).toBe('2222222222222222222222222222222222222222222222222222222222222222'));
  });

  describe('Sysmon Registry (Event 13) — Registry-Entity (IFEO)', () => {
    const ALERT = {
      id: 'r1', rule: { id: '92300', level: 12, description: 'Sysmon Registry Set', groups: ['sysmon'], mitre: { id: ['T1546.012'] } },
      agent: { id: '007', name: 'WIN01', ip: '10.99.99.50' }, decoder: { name: 'windows' },
      data: { win: { eventdata: {
        targetObject: 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe\Debugger',
        eventType: 'SetValue', valueName: 'Debugger', details: 'C:\Windows\System32\cmd.exe',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('registry.key (IFEO-Pfad)', () => expect(r.registry?.key).toContain('Image File Execution Options'));
    test('registry.valueName', () => expect(r.registry?.valueName).toBe('Debugger'));
    test('registry.newValue', () => expect(r.registry?.newValue).toBe('C:\Windows\System32\cmd.exe'));
    test('registry.operation', () => expect(r.registry?.operation).toBe('SetValue'));
  });

  describe('DNS (Sysmon DnsQuery Event 22)', () => {
    const ALERT = {
      rule: { id: '92000', level: 8, description: 'Sysmon DNS query' },
      agent: { id: '004', name: 'WEC01', ip: '10.99.99.11' },
      data: { win: { eventdata: {
        queryName: 'malicious.example.com',
        queryResults: 'type:  5 cdn.example.com;type:  1 93.184.216.34;',
        queryStatus: '0',
        image: 'C:\\Windows\\System32\\powershell.exe',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('dns.query', () => expect(r.dns?.query).toBe('malicious.example.com'));
    test('dns.answers parst Typ-Präfixe weg', () => {
      expect(r.dns?.answers).toEqual(['cdn.example.com', '93.184.216.34']);
      expect(r.dns?.answersStr).toBe('cdn.example.com, 93.184.216.34');
    });
    test('dns.image (anfragender Prozess)', () => expect(r.dns?.image).toContain('powershell.exe'));
    test('kein queryName → kein dns', () => expect(normalize({ data: { win: { eventdata: {} } } }).dns).toBeUndefined());
  });

  describe('Network (Sysmon NetworkConnect Event 3)', () => {
    const ALERT = {
      rule: { id: '92001', level: 7, description: 'Sysmon network connection' },
      agent: { id: '004', name: 'WEC01', ip: '10.99.99.11' },
      data: { win: { eventdata: {
        sourceIp: '10.99.99.11', sourcePort: '52344', sourceHostname: 'WEC01.nexora.example',
        destinationIp: '93.184.216.34', destinationPort: '443', destinationHostname: 'example.com',
        protocol: 'tcp', initiated: 'true', image: 'C:\\Windows\\System32\\powershell.exe',
      } } },
    };
    let r; beforeEach(() => { r = normalize(ALERT); });
    test('network.dstIp + dstHostname aus Sysmon-eventdata', () => {
      expect(r.network?.dstIp).toBe('93.184.216.34');
      expect(r.network?.dstHostname).toBe('example.com');
    });
    test('network.srcHostname', () => expect(r.network?.srcHostname).toBe('WEC01.nexora.example'));
    test('initiated:true → direction outbound', () => expect(r.network?.direction).toBe('outbound'));
    test('network.image (verbindender Prozess)', () => expect(r.network?.image).toContain('powershell.exe'));
  });
});
