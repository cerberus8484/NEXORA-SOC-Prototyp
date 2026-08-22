import { describe, it, expect } from 'vitest';
import { KI_QUERIES, buildKiIocRows, kiIocTabs } from './kiModel';
import type { AgentAnalysis } from '../../aiAgent/agentApi';

const analysis = (over: Partial<AgentAnalysis> = {}): AgentAnalysis => ({
  entities: {}, iocs: [], verdict: 'suspicious', confidence: 80,
  confirmedFacts: [], suspiciousIndicators: [], missingEvidence: [], recommendedActions: [], mitreAttack: [], ...over,
});

describe('KI_QUERIES', () => {
  it('deckt die 9 Backend-kinds ab', () => {
    expect(KI_QUERIES).toHaveLength(9);
    expect(KI_QUERIES.map((q) => q.kind)).toEqual(expect.arrayContaining(['triage', 'mitre_mapping', 'next_steps', 'customer_response']));
  });
});

describe('buildKiIocRows', () => {
  it('mappt KI-IOCs mit normalisiertem Typ + Beschreibung/Quelle/Confidence', () => {
    const rows = buildKiIocRows(analysis({
      iocs: [
        { type: 'ipv4', value: '185.199.108.153', reason: 'C2', evidenceSource: 'Threat Intel', verdict: 'high' },
        { type: 'SHA256', value: 'abc', reason: 'file hash', evidenceSource: 'Wazuh FIM' },
      ],
    }));
    const ip = rows.find((r) => r.value === '185.199.108.153')!;
    expect(ip.type).toBe('ip');
    expect(ip.description).toBe('C2');
    expect(ip.source).toBe('Threat Intel');
    expect(ip.confidence).toBe('high');
    expect(rows.find((r) => r.value === 'abc')?.type).toBe('hash');
  });

  it('ergänzt Entities + MITRE und dedupliziert', () => {
    const rows = buildKiIocRows(analysis({
      iocs: [{ type: 'ip', value: '10.0.0.5' }],
      entities: { network: { destinationIp: '10.0.0.5' }, user: { username: 'j.bauer' }, process: { name: 'powershell.exe' } },
      mitreAttack: [{ techniqueId: 'T1059.001', technique: 'PowerShell', tactic: 'Execution' }],
    }));
    // 10.0.0.5 nur einmal (IOC + Entity dedupliziert)
    expect(rows.filter((r) => r.value === '10.0.0.5')).toHaveLength(1);
    expect(rows.find((r) => r.type === 'user')?.value).toBe('j.bauer');
    expect(rows.find((r) => r.type === 'mitre')?.value).toBe('T1059.001');
  });

  it('ist leer ohne IOCs/Entities/MITRE', () => {
    expect(buildKiIocRows(analysis())).toHaveLength(0);
  });
});

describe('kiIocTabs', () => {
  it('liefert „all" + vorhandene Typen in fester Reihenfolge', () => {
    const rows = buildKiIocRows(analysis({
      iocs: [{ type: 'ip', value: '1.2.3.4' }, { type: 'domain', value: 'bad.test' }],
      mitreAttack: [{ techniqueId: 'T1105' }],
    }));
    expect(kiIocTabs(rows)).toEqual(['all', 'ip', 'domain', 'mitre']);
  });
});
