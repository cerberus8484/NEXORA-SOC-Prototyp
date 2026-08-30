import { describe, test, expect } from 'vitest';
import { computeHostRisk, applyHostRisk, riskLevelFromScore } from './hostRisk';
import type { RegisteredHost } from './hostsTypes';

const base = (over: Partial<RegisteredHost> = {}): RegisteredHost => ({
  id: 'a1', hostname: 'h1', source: 'wazuh', agentVersion: 'v4.14',
  heartbeatStatus: 'healthy', inventoryStatus: 'complete', ...over,
});

describe('computeHostRisk', () => {
  test('gesunder, vollständiger Host → niedriges Risiko', () => {
    const r = computeHostRisk(base());
    expect(r.score).toBe(0);
    expect(r.level).toBe('low');
    expect(r.factors).toHaveLength(0);
  });

  test('offline + Inventory fehlt → höher, mit Faktoren', () => {
    const r = computeHostRisk(base({ heartbeatStatus: 'offline', inventoryStatus: 'missing' }));
    expect(r.score).toBe(55);
    expect(r.level).toBe('high');
    expect(r.factors).toEqual(['Agent offline (keine Sicht)', 'Inventory fehlt']);
  });

  test('Inventory-Signale zählen (Patches/Software/Ports)', () => {
    const r = computeHostRisk(base({ inventory: { missingPatches: 3, suspiciousSoftwareCount: 2, openPortsCount: 60 } }));
    // 12 (patches) + 20 (susp, gecappt) + 15 (ports >50) = 47
    expect(r.score).toBe(47);
    expect(r.level).toBe('medium');
    expect(r.factors).toContain('3 fehlende Patches');
    expect(r.factors).toContain('60 offene Ports');
  });

  test('echte CVE-Counts treiben das Risiko (kritisch am stärksten)', () => {
    const r = computeHostRisk(base({ inventory: { cveCritical: 3, cveHigh: 4 } }));
    // 24 (3 crit * 8) + 8 (4 high * 2) = 32
    expect(r.score).toBe(32);
    expect(r.level).toBe('medium');
    expect(r.factors).toContain('3 kritische CVEs');
    expect(r.factors).toContain('4 hohe CVEs');
  });

  test('niedrige SCA-Compliance erhöht das Risiko', () => {
    const low = computeHostRisk(base({ inventory: { scaScore: 24 } }));
    expect(low.score).toBe(20);
    expect(low.factors).toContain('SCA-Compliance niedrig (24/100)');
    const mid = computeHostRisk(base({ inventory: { scaScore: 70 } }));
    expect(mid.score).toBe(10);
    const ok = computeHostRisk(base({ inventory: { scaScore: 90 } }));
    expect(ok.score).toBe(0);
  });

  test('Score wird bei 100 gekappt', () => {
    const r = computeHostRisk(base({
      heartbeatStatus: 'offline', inventoryStatus: 'missing', agentVersion: undefined,
      inventory: { missingPatches: 50, suspiciousSoftwareCount: 50, openPortsCount: 100 },
    }));
    expect(r.score).toBe(100);
    expect(r.level).toBe('critical');
  });

  test('riskLevelFromScore-Schwellen', () => {
    expect(riskLevelFromScore(0)).toBe('low');
    expect(riskLevelFromScore(25)).toBe('medium');
    expect(riskLevelFromScore(50)).toBe('high');
    expect(riskLevelFromScore(75)).toBe('critical');
  });

  test('applyHostRisk hängt score+level an', () => {
    const h = applyHostRisk(base({ heartbeatStatus: 'delayed' }));
    expect(h.riskScore).toBe(15);
    expect(h.riskLevel).toBe('low');
  });
});
