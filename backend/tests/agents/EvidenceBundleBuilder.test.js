'use strict';

const { build }          = require('../../src/agents/bundle/EvidenceBundleBuilder');
const { EvidenceBundle } = require('../../src/agents/bundle/EvidenceBundle');

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

const SYSMON_PS = {
  id: 'def456',
  rule: { id: '92200', level: 12, description: 'Sysmon Process Creation', groups: ['sysmon'],
    mitre: { id: ['T1059.001'], tactic: ['Execution'], technique: ['PowerShell'] } },
  agent: { id: '007', name: 'WIN-CLIENT-01', ip: '192.168.240.55' },
  manager: { name: 'wazuh-manager' },
  decoder: { name: 'windows_decoders' },
  location: 'EventChannel',
  full_log: 'EventID 1 powershell.exe',
  data: {
    win: {
      eventdata: {
        image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        commandLine: 'powershell.exe -EncodedCommand aABlAGwAbABvAA==',
        parentImage: 'C:\\Windows\\System32\\cmd.exe',
        user: 'CORP\\jsmith',
        processId: '4444',
      },
    },
  },
};

const BASE_TICKET = { id: 'T-001', title: 'SSH MACs Test', category: 'Config', priority: 'medium' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EvidenceBundleBuilder.build()', () => {

  // ── Rückgabe-Typ ──────────────────────────────────────────────────────────

  test('gibt immer ein EvidenceBundle zurück', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle).toBeInstanceOf(EvidenceBundle);
  });

  test('schemaVersion ist korrekt gesetzt', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.schemaVersion).toBe('ai-evidence-bundle/v1');
  });

  test('Ticket ist im Bundle gespeichert', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.ticket.id).toBe('T-001');
    expect(bundle.ticket.title).toBe('SSH MACs Test');
  });

  // ── Kein Alert ────────────────────────────────────────────────────────────

  test('ohne Evidence → wazuhAlert.available=false', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.wazuhAlert.available).toBe(false);
    expect(bundle.hasAlert).toBe(false);
  });

  test('ohne Evidence → hasEvidence=false', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.hasEvidence).toBe(false);
  });

  test('ohne Alert → missingData enthält evidence-Hinweis', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.missingData.some(m => m.includes('evidence'))).toBe(true);
  });

  // ── Wazuh-Alert aus Evidence ──────────────────────────────────────────────

  test('findet Wazuh-Alert in Evidence (type=wazuh_alert, Objekt)', () => {
    const evidence = [{ type: 'wazuh_alert', value: RULE_19011 }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.hasAlert).toBe(true);
    expect(bundle.wazuhAlert.ruleId).toBe('19011');
  });

  test('findet Wazuh-Alert in Evidence (JSON-String)', () => {
    const evidence = [{ type: 'wazuh_alert', value: JSON.stringify(RULE_19011) }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.hasAlert).toBe(true);
    expect(bundle.wazuhAlert.ruleId).toBe('19011');
  });

  test('ignoriert andere Evidence-Typen', () => {
    const evidence = [{ type: 'manual_note', value: 'Irgendwas' }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.hasAlert).toBe(false);
  });

  test('überspringt fehlerhafte JSON-Strings, nimmt nächsten', () => {
    const evidence = [
      { type: 'wazuh_alert', value: '{kaputt}' },
      { type: 'wazuh_alert', value: RULE_19011 },
    ];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.hasAlert).toBe(true);
  });

  // ── Wazuh-Alert aus Ticket-Logs (Fallback) ────────────────────────────────

  test('extrahiert Alert aus ticket.logs via "Raw Alert (JSON):" Marker', () => {
    const ticket = { ...BASE_TICKET, logs: `Andere Logs\nRaw Alert (JSON):\n${JSON.stringify(RULE_19011)}` };
    const bundle = build(ticket, []);
    expect(bundle.hasAlert).toBe(true);
    expect(bundle.wazuhAlert.ruleId).toBe('19011');
  });

  test('Evidence hat Vorrang vor ticket.logs', () => {
    const ticket = { ...BASE_TICKET, logs: `Raw Alert (JSON):\n${JSON.stringify(RULE_19011)}` };
    const evidence = [{ type: 'wazuh_alert', value: SYSMON_PS }];
    const bundle = build(ticket, evidence);
    expect(bundle.wazuhAlert.ruleId).toBe('92200'); // aus Evidence, nicht aus logs
  });

  // ── Observations ─────────────────────────────────────────────────────────

  test('RULE_19011 → Observation für Severity "Hoch" (Level 9)', () => {
    const evidence = [{ type: 'wazuh_alert', value: RULE_19011 }];
    const bundle = build(BASE_TICKET, evidence);
    const sev = bundle.derivedObservations.find(o => o.category === 'severity');
    expect(sev).toBeDefined();
    expect(sev.label).toBe('Hoch');
  });

  test('SYSMON_PS → Observation für MITRE Technique T1059.001', () => {
    const evidence = [{ type: 'wazuh_alert', value: SYSMON_PS }];
    const bundle = build(BASE_TICKET, evidence);
    const mitre = bundle.derivedObservations.find(
      o => o.category === 'mitre' && o.value === 'T1059.001'
    );
    expect(mitre).toBeDefined();
  });

  test('SYSMON_PS → Observation für Evasion-Indikator (EncodedCommand)', () => {
    const evidence = [{ type: 'wazuh_alert', value: SYSMON_PS }];
    const bundle = build(BASE_TICKET, evidence);
    const evasion = bundle.derivedObservations.find(o =>
      o.category === 'process' && /verdächtig|evasion|obfusk/i.test(o.label)
    );
    expect(evasion).toBeDefined();
  });

  test('SYSMON_PS → Observation für Host-Name WIN-CLIENT-01', () => {
    const evidence = [{ type: 'wazuh_alert', value: SYSMON_PS }];
    const bundle = build(BASE_TICKET, evidence);
    const host = bundle.derivedObservations.find(
      o => o.category === 'host' && o.value === 'WIN-CLIENT-01'
    );
    expect(host).toBeDefined();
  });

  test('Level 12 → Severity-Observation "Kritisch"', () => {
    const critAlert = { ...RULE_19011, rule: { ...RULE_19011.rule, level: 12 } };
    const evidence = [{ type: 'wazuh_alert', value: critAlert }];
    const bundle = build(BASE_TICKET, evidence);
    const sev = bundle.derivedObservations.find(o => o.category === 'severity');
    expect(sev.label).toBe('Kritisch');
  });

  test('ohne Alert → keine Observations', () => {
    const bundle = build(BASE_TICKET, []);
    expect(bundle.derivedObservations).toHaveLength(0);
  });

  // ── fehlende Daten ────────────────────────────────────────────────────────

  test('RULE_19011 → agent.ip fehlt in missingData', () => {
    const evidence = [{ type: 'wazuh_alert', value: RULE_19011 }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.missingData).toContain('agent.ip');
  });

  test('SYSMON_PS hat Agent-IP → agent.ip NICHT in missingData', () => {
    const evidence = [{ type: 'wazuh_alert', value: SYSMON_PS }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.missingData).not.toContain('agent.ip');
  });

  // ── Unveränderlichkeit ────────────────────────────────────────────────────

  test('bundle ist eingefroren — keine Mutation möglich', () => {
    const bundle = build(BASE_TICKET, []);
    expect(() => { bundle.schemaVersion = 'x'; }).toThrow();
  });

  test('toJSON() gibt serialisierbares Objekt zurück', () => {
    const evidence = [{ type: 'wazuh_alert', value: RULE_19011 }];
    const bundle = build(BASE_TICKET, evidence);
    const json = bundle.toJSON();
    expect(() => JSON.stringify(json)).not.toThrow();
    expect(json.schemaVersion).toBe('ai-evidence-bundle/v1');
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────

  test('null Ticket → Bundle ohne Fehler', () => {
    expect(() => build(null, [])).not.toThrow();
  });

  test('undefined Evidence → behandelt als leeres Array', () => {
    expect(() => build(BASE_TICKET, undefined)).not.toThrow();
  });

  test('rawValue statt value wird erkannt', () => {
    const evidence = [{ type: 'wazuh_alert', rawValue: RULE_19011 }];
    const bundle = build(BASE_TICKET, evidence);
    expect(bundle.hasAlert).toBe(true);
  });

  describe('VirusTotal-Observation', () => {
    const VT_ALERT = {
      id: 'vt1',
      rule: { id: '87105', level: 12, description: 'VirusTotal: malicious', groups: ['virustotal'], mitre: {} },
      agent: { id: '004', name: 'WEC01', ip: '10.99.99.11' },
      decoder: { name: 'json' }, location: 'virustotal', full_log: 'EICAR',
      data: { virustotal: { found: '1', malicious: '60', total: '70', source: { file: 'C:\\fim-test\\eicar.com' } } },
    };

    test('malicious≥1 → threatintel-Observation mit BÖSARTIG', () => {
      const bundle = build(BASE_TICKET, [{ type: 'wazuh_alert', value: VT_ALERT }]);
      const ti = bundle.derivedObservations.find((o) => o.category === 'threatintel');
      expect(ti).toBeTruthy();
      expect(ti.value).toMatch(/BÖSARTIG/);
      expect(ti.value).toContain('60/70');
    });

    test('malicious=0 → Observation kennzeichnet extern unauffällig', () => {
      const clean = { ...VT_ALERT, data: { virustotal: { found: '0', malicious: '0', total: '70' } } };
      const bundle = build(BASE_TICKET, [{ type: 'wazuh_alert', value: clean }]);
      const ti = bundle.derivedObservations.find((o) => o.category === 'threatintel');
      expect(ti.value).toMatch(/unauffällig/);
    });
  });

  // ── Owned-Asset-Observations (Scope A) ────────────────────────────────────

  describe('Owned-Asset-Kontext', () => {
    const DATAPLANE_TICKET = {
      id: 'INC000770',
      title: '[observed] honeypot 205.210.31.67 → 203.0.113.246',
      category: 'cross_domain_correlation',
      priority: 'info',
      srcIp: '205.210.31.67',
      dstIp: '203.0.113.246',
      attackerIp: '205.210.31.67',
    };
    const ASSET_CFG = { honeypotIps: ['203.0.113.246'], internalCidrs: ['10.0.10.0/24'] };

    test('Ziel-IP (eigener Honeypot) wird als asset-Observation getaggt', () => {
      const bundle = build(DATAPLANE_TICKET, [], ASSET_CFG);
      const dst = bundle.derivedObservations.find(
        (o) => o.category === 'asset' && o.label.includes('203.0.113.246')
      );
      expect(dst).toBeDefined();
      expect(dst.value).toMatch(/Honeypot/i);
    });

    test('Quell-IP wird als extern getaggt', () => {
      const bundle = build(DATAPLANE_TICKET, [], ASSET_CFG);
      const src = bundle.derivedObservations.find(
        (o) => o.category === 'asset' && o.label.includes('205.210.31.67')
      );
      expect(src).toBeDefined();
      expect(src.value).toBe('extern');
    });

    test('Synthese: Ziel = eigener Honeypot + kein interner Host → Einordnung', () => {
      const bundle = build(DATAPLANE_TICKET, [], ASSET_CFG);
      const synth = bundle.derivedObservations.find(
        (o) => o.category === 'asset' && o.label === 'Einordnung'
      );
      expect(synth).toBeDefined();
      expect(synth.value).toMatch(/Honeypot/i);
      expect(synth.value).toMatch(/kein interner Host/i);
    });

    test('interner Host beteiligt → KEINE Honeypot-Synthese', () => {
      const ticket = { ...DATAPLANE_TICKET, srcIp: '10.0.10.5' };
      const bundle = build(ticket, [], ASSET_CFG);
      const synth = bundle.derivedObservations.find(
        (o) => o.category === 'asset' && o.label === 'Einordnung'
      );
      expect(synth).toBeUndefined();
    });

    test('ohne Asset-Config → kein Honeypot-Tag, IPs bleiben extern', () => {
      const bundle = build(DATAPLANE_TICKET, [], { honeypotIps: [], internalCidrs: [] });
      const honeypot = bundle.derivedObservations.find(
        (o) => o.category === 'asset' && /Honeypot/i.test(o.value)
      );
      expect(honeypot).toBeUndefined();
    });

    test('Ticket ohne IPs → keine asset-Observations', () => {
      const bundle = build(BASE_TICKET, [], ASSET_CFG);
      const asset = bundle.derivedObservations.filter((o) => o.category === 'asset');
      expect(asset).toHaveLength(0);
    });
  });

  describe('Threat-Intel-Kontext aus Ticket/Evidence', () => {
    const DATAPLANE_TICKET = {
      id: 'INC000770',
      title: '[observed] honeypot 205.210.31.67 -> 203.0.113.246',
      category: 'cross_domain_correlation',
      priority: 'info',
      srcIp: '205.210.31.67',
      dstIp: '203.0.113.246',
    };

    test('Threat-Intel-Evidence wird als Observation sichtbar', () => {
      const evidence = [{
        type: 'threat_intel',
        source: 'threatIntel',
        title: 'Threat Intel: 205.210.31.67 (suspicious)',
        rawText: JSON.stringify({
          indicatorValue: '205.210.31.67',
          verdict: 'suspicious',
          score: 65,
          confidence: 72,
          source: 'provider',
          summary: 'AbuseIPDB: 65% Confidence, 120 Reports.',
        }),
      }];
      const bundle = build(DATAPLANE_TICKET, evidence, { honeypotIps: [], internalCidrs: [] });
      const ti = bundle.derivedObservations.find(
        (o) => o.category === 'threatintel' && o.label.includes('205.210.31.67')
      );
      expect(ti).toBeDefined();
      expect(ti.value).toContain('suspicious');
      expect(ti.value).toContain('65');
    });

    test('Scanner-Hinweise aus Threat Intel werden als eigene Einordnung abgeleitet', () => {
      const evidence = [{
        type: 'threat_intel',
        source: 'threatIntel',
        title: 'Threat Intel: 205.210.31.67 (unknown)',
        rawText: JSON.stringify({
          indicatorValue: '205.210.31.67',
          verdict: 'unknown',
          score: 5,
          confidence: 40,
          source: 'provider',
          summary: 'Known internet scanner / research crawler.',
          tags: ['scanner', 'internet-measurement'],
          usageType: 'Data Center/Web Hosting/Transit',
        }),
      }];
      const bundle = build(DATAPLANE_TICKET, evidence, { honeypotIps: ['203.0.113.246'], internalCidrs: ['10.0.10.0/24'] });
      const scanner = bundle.derivedObservations.find(
        (o) => o.category === 'threatintel' && o.label === 'Scanner-Kontext'
      );
      expect(scanner).toBeDefined();
      expect(scanner.value).toMatch(/Scanner/i);
      expect(scanner.value).toMatch(/Honeypot/i);
    });

    test('malicious Threat Intel bleibt hartes Signal und wird nicht als Scanner-Noise entschÃ¤rft', () => {
      const evidence = [{
        type: 'threat_intel',
        source: 'threatIntel',
        title: 'Threat Intel: 205.210.31.67 (malicious)',
        rawText: JSON.stringify({
          indicatorValue: '205.210.31.67',
          verdict: 'malicious',
          score: 100,
          confidence: 90,
          summary: 'scanner tag, but provider verdict is malicious',
          tags: ['scanner'],
        }),
      }];
      const bundle = build(DATAPLANE_TICKET, evidence, { honeypotIps: ['203.0.113.246'], internalCidrs: [] });
      const scanner = bundle.derivedObservations.find(
        (o) => o.category === 'threatintel' && o.label === 'Scanner-Kontext'
      );
      expect(scanner).toBeUndefined();
      expect(bundle.derivedObservations.find((o) => o.category === 'threatintel')?.value).toContain('malicious');
    });

    test('manuelle tiEntries am Ticket werden in den Prompt-Kontext Ã¼bernommen', () => {
      const ticket = {
        ...DATAPLANE_TICKET,
        tiEntries: [{ category: 'Scanner', actor: 'Internet-wide scanner', malware: '', confidence: 'Medium' }],
      };
      const bundle = build(ticket, [], { honeypotIps: [], internalCidrs: [] });
      const entry = bundle.derivedObservations.find(
        (o) => o.category === 'threatintel' && o.label.includes('Ticket-TI')
      );
      expect(entry).toBeDefined();
      expect(entry.value).toContain('Internet-wide scanner');
    });
  });
});
