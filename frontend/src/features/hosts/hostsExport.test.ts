import { describe, test, expect } from 'vitest';
import { hostsToCsv } from './hostsExport';
import type { RegisteredHost } from './hostsTypes';

const hosts: RegisteredHost[] = [
  {
    id: '1', hostname: 'WindowsClient', customer: 'ACME, Inc.', source: 'wazuh',
    agentId: '001', agentVersion: 'v4.14', os: { name: 'Windows 10' },
    ipAddresses: ['192.168.241.102', '10.0.0.5'], heartbeatStatus: 'healthy',
    inventoryStatus: 'complete', riskScore: 20, riskLevel: 'low', lastHeartbeatAt: '2026-06-13T05:00:00Z',
  },
];

describe('hostsToCsv', () => {
  test('Header + Datenzeile', () => {
    const csv = hostsToCsv(hosts);
    const [header, row] = csv.split('\n');
    expect(header.startsWith('Hostname,Customer,Source,OS,IP')).toBe(true);
    expect(row).toContain('WindowsClient');
    expect(row).toContain('192.168.241.102 10.0.0.5'); // IPs leerzeichengetrennt
    expect(row).toContain('20');
  });

  test('quotet Felder mit Komma', () => {
    const csv = hostsToCsv(hosts);
    expect(csv).toContain('"ACME, Inc."');
  });

  test('leere Liste → nur Header', () => {
    const csv = hostsToCsv([]);
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toContain('Hostname');
  });
});
