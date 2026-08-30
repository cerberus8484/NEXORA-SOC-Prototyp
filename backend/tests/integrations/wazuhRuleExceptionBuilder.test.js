'use strict';

const { buildFpException, scopeFromEvidence, recommendExceptionTarget, MIN_ID } = require('../../src/integrations/adapters/wazuh/wazuhRuleExceptionBuilder');

const validScope = {
  ruleId: '87702', srcips: ['192.168.240.109'], dstips: ['224.0.0.0/24'],
  reason: 'local multicast false positive', ticketId: 'f192eb40', analyst: 'Thorsten',
};

describe('wazuhRuleExceptionBuilder', () => {
  test('erzeugt eine scoped Level-0-Ausnahme mit if_sid + srcip + dstip', () => {
    const r = buildFpException(validScope);
    expect(r.ok).toBe(true);
    expect(r.xml).toContain('<rule id="900100" level="0">');
    expect(r.xml).toContain('<if_sid>87702</if_sid>');
    expect(r.xml).toContain('<srcip>192.168.240.109</srcip>');
    expect(r.xml).toContain('<dstip>224.0.0.0/24</dstip>');
    expect(r.xml).toContain('<group>soc_false_positive,</group>');
    expect(r.file).toBe('soc_fp_exceptions.xml');
  });

  test('GUARDRAIL (D): keine globale Ausnahme — ohne srcip/dstip/agent wird abgelehnt', () => {
    const r = buildFpException({ ruleId: '87702', reason: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/einschränkendes Scope-Kriterium/);
    expect(r.xml).toBe('');
  });

  test('GUARDRAIL (E): Reason ist Pflicht — auch bei Agent-Scope', () => {
    const r = buildFpException({ ...validScope, reason: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Begründung/);
    const r2 = buildFpException({ ruleId: '52502', agentId: '005', agentName: 'Proxmox' });
    expect(r2.ok).toBe(false);
    expect(r2.errors.join(' ')).toMatch(/Begründung/);
  });

  test('Host-FP (B): ClamAV — Agent-Scope ohne Netz-IPs erzeugt hostname-Selector', () => {
    const r = buildFpException({ ruleId: '52502', agentId: '005', agentName: 'Proxmox', reason: 'ClamAV Eigenscan — bestätigtes FP' });
    expect(r.ok).toBe(true);
    expect(r.applyBlocked).toBe(false);
    expect(r.xml).toContain('<if_sid>52502</if_sid>');
    expect(r.xml).toContain('<hostname>Proxmox</hostname>');
    expect(r.xml).not.toContain('<srcip>');
    expect(r.xml).not.toContain('<dstip>');
    expect(r.warnings.join(' ')).toMatch(/wazuh-logtest/);
  });

  test('Host-FP (B2): nur Agent-ID ohne Name — Vorschau ja, Apply blockiert + Warnung', () => {
    const r = buildFpException({ ruleId: '52502', agentId: '005', reason: 'ClamAV FP' });
    expect(r.ok).toBe(true);
    expect(r.applyBlocked).toBe(true);
    expect(r.xml).not.toContain('<hostname>');
    expect(r.warnings.join(' ')).toMatch(/syntax verification before apply/i);
  });

  test('Host-FP (C): Windows/FIM — Agent-Scope für 19005/100708', () => {
    for (const ruleId of ['19005', '100708']) {
      const r = buildFpException({ ruleId, agentId: '009', agentName: 'DC01', reason: 'Erwartetes Verhalten auf DC01' });
      expect(r.ok).toBe(true);
      expect(r.xml).toContain(`<if_sid>${ruleId}</if_sid>`);
      expect(r.xml).toContain('<hostname>DC01</hostname>');
    }
  });

  test('Netzwerk-FP (A): srcip+dstip-Scope funktioniert unverändert ohne Agent-Felder', () => {
    const r = buildFpException(validScope);
    expect(r.ok).toBe(true);
    expect(r.applyBlocked).toBe(false);
    expect(r.xml).not.toContain('<hostname>');
  });

  test('GUARDRAIL: ungültige IP/CIDR wird abgelehnt', () => {
    const r = buildFpException({ ...validScope, dstips: ['999.0.0.1'] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Ungültige IP/);
  });

  test('GUARDRAIL: Rule-ID muss im Custom-Range liegen', () => {
    const r = buildFpException({ ...validScope, newRuleId: 5000 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/900000/);
  });

  test('optionale Felder: Port + Protokoll erzeugen Felder + Warnung', () => {
    const r = buildFpException({ ...validScope, dstports: ['5353'], protocol: 'UDP' });
    expect(r.ok).toBe(true);
    expect(r.xml).toContain('<dstport>5353</dstport>');
    expect(r.xml).toContain('<field name="protocol">UDP</field>');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('Listen: mehrere src/dst werden zusammengeführt (CIDR + IP)', () => {
    const r = buildFpException({ ...validScope, srcips: ['192.168.240.109', '192.168.240.110'], dstips: ['224.0.0.0/24'] });
    expect(r.xml).toContain('<srcip>192.168.240.109,192.168.240.110</srcip>');
  });

  test('scopeFromEvidence: Multicast → 224.0.0.0/24-Vorschlag', () => {
    const ev = { detection: { ruleId: '87702' }, source: { ip: '192.168.240.109' }, destination: { ip: '224.0.0.7', port: 5353 }, network: { protocol: 'UDP' }, metadata: { agentId: '003' } };
    const s = scopeFromEvidence(ev, { ticketNr: 'NX-1' });
    expect(s.ruleId).toBe('87702');
    expect(s.srcips).toEqual(['192.168.240.109']);
    expect(s.dstips).toEqual(['224.0.0.7']);
    expect(s.dstipSuggestion).toBe('224.0.0.0/24');
    expect(s.dstports).toEqual(['5353']);
  });

  test('scopeFromEvidence: Host-Alert ohne Netz-IPs → Agent-ID + Agent-Name im Scope', () => {
    const ev = { detection: { ruleId: '52502' }, metadata: { agentId: '005', agentName: 'Proxmox' } };
    const s = scopeFromEvidence(ev, { ticketNr: 'INC000100' });
    expect(s.ruleId).toBe('52502');
    expect(s.srcips).toEqual([]);
    expect(s.dstips).toEqual([]);
    expect(s.agentId).toBe('005');
    expect(s.agentName).toBe('Proxmox');
  });

  test('Default-Rule-ID liegt im Custom-Range', () => {
    expect(buildFpException(validScope).ruleId).toBeGreaterThanOrEqual(MIN_ID);
  });

  describe('recommendExceptionTarget (Frequency-Regel → Basis-Regel)', () => {
    test('null-Detail → keine Empfehlung', () => {
      expect(recommendExceptionTarget(null)).toEqual({ isFrequencyRule: false, baseRuleId: null, recommendedIfSid: null });
    });
    test('Frequency-Regel (if_matched_sid) → Basis-Regel empfohlen', () => {
      const r = recommendExceptionTarget({ id: 87702, frequency: 18, ifMatchedSid: '87701' });
      expect(r.isFrequencyRule).toBe(true);
      expect(r.baseRuleId).toBe('87701');
      expect(r.recommendedIfSid).toBe('87701');
    });
    test('normale Regel → sie selbst, keine Frequency', () => {
      const r = recommendExceptionTarget({ id: 100500, frequency: null, ifMatchedSid: null });
      expect(r.isFrequencyRule).toBe(false);
      expect(r.baseRuleId).toBeNull();
      expect(r.recommendedIfSid).toBe('100500');
    });
  });

  // Quell-agnostische Ziel-Ausnahmen: mDNS/SSDP-Multicast kommt von VIELEN
  // Quellen → eine srcip-gebundene Ausnahme ist Whack-a-Mole. dstip-only ist
  // hier korrekt, aber nur für Multicast/Broadcast ODER mit Port (sonst würde
  // 87702 für JEDE Quelle zu diesem Host stummgeschaltet).
  describe('quell-agnostische Ziel-Ausnahmen', () => {
    const base = { ruleId: '87702', reason: 'mDNS-Multicast-Rauschen, erwartet' };

    test('Multicast-Ziel ohne srcip → erlaubt, kein <srcip>', () => {
      const r = buildFpException({ ...base, dstips: ['224.0.0.0/24'] });
      expect(r.ok).toBe(true);
      expect(r.xml).toContain('<dstip>224.0.0.0/24</dstip>');
      expect(r.xml).not.toContain('<srcip>');
    });

    test('Broadcast-Ziel ohne srcip → erlaubt', () => {
      expect(buildFpException({ ...base, dstips: ['255.255.255.255'] }).ok).toBe(true);
      expect(buildFpException({ ...base, dstips: ['192.168.240.255'] }).ok).toBe(true);
    });

    test('Unicast-Ziel ohne srcip UND ohne Port → abgelehnt (kein Quell-Global)', () => {
      const r = buildFpException({ ...base, dstips: ['10.0.0.5'] });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/quell-agnostisch|Multicast|Broadcast|Port/i);
    });

    test('Unicast-Ziel ohne srcip ABER mit Port → erlaubt (Port engt ein)', () => {
      const r = buildFpException({ ...base, dstips: ['10.0.0.5'], dstports: ['5353'] });
      expect(r.ok).toBe(true);
      expect(r.xml).toContain('<dstport>5353</dstport>');
    });
  });
});
