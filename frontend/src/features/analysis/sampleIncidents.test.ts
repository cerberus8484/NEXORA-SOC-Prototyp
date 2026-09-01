import { describe, expect, it } from 'vitest';
import { buildSampleIncidents } from './sampleIncidents';

describe('buildSampleIncidents', () => {
  it('provides ten distinct synthetic incidents with required ticket fields', () => {
    const samples = buildSampleIncidents();
    expect(samples).toHaveLength(10);
    expect(new Set(samples.map((sample) => sample.title)).size).toBe(10);
    for (const sample of samples) {
      expect(sample.source).toBe('manual');
      expect(sample.mitre).toMatch(/^T\d{4}(\.\d{3})?$/);
      expect(sample.logs).toContain('[Wazuh]');
      expect(sample.logs).toContain('[Zeek/Firewall]');
      expect(sample.logs).toContain('[Internal ICMP]');
      expect(sample.payloads).toHaveLength(3);
      expect(sample.firstSeen).toBeTruthy();
      expect(sample.lastSeen).toBeTruthy();
      expect(sample.priority).toMatch(/medium|high|critical/);
    }
  });

  it('covers concrete remote-services and lateral-movement techniques', () => {
    expect(buildSampleIncidents().map((sample) => sample.mitre)).toEqual([
      'T1021.002', 'T1021.006', 'T1047', 'T1569.002', 'T1550.002',
      'T1563.002', 'T1021.001', 'T1053.005', 'T1021.004', 'T1003.006',
    ]);
  });
});
