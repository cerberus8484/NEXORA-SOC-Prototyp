import { describe, test, expect } from 'vitest';
import { manualHostToRegistered } from './manualHostModel';

describe('manualHostToRegistered', () => {
  test('mappt Kernfelder + source=manual', () => {
    const r = manualHostToRegistered({
      id: 'h1', hostname: 'fw-edge', ipAddresses: ['10.0.10.1'], os: 'OPNsense', customer: 'ACME', source: 'manual',
    });
    expect(r).toMatchObject({ id: 'h1', hostname: 'fw-edge', source: 'manual', ipAddresses: ['10.0.10.1'] });
    expect(r.os).toEqual({ name: 'OPNsense' });
    expect(r.customer).toBe('ACME');
  });

  test('ehrlich: unmonitored Heartbeat + missing Inventory, kein Risk-Score', () => {
    const r = manualHostToRegistered({ id: 'h2', hostname: 'x', source: 'manual' });
    expect(r.heartbeatStatus).toBe('unmonitored');
    expect(r.inventoryStatus).toBe('missing');
    expect(r.ipAddresses).toEqual([]);
    expect(r.riskScore).toBeUndefined();
    expect(r.lastHeartbeatAt).toBeUndefined();
  });

  test('leerer customer → undefined (kein leerer String)', () => {
    const r = manualHostToRegistered({ id: 'h3', hostname: 'x', customer: '', source: 'manual' });
    expect(r.customer).toBeUndefined();
  });

  test('fehlendes os → kein os-Objekt', () => {
    const r = manualHostToRegistered({ id: 'h4', hostname: 'x', source: 'manual' });
    expect(r.os).toBeUndefined();
  });
});
