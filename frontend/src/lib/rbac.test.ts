import { describe, it, expect } from 'vitest';
import { hasRole, can } from './rbac';

describe('rbac.hasRole', () => {
  it('admin erfüllt alle Stufen', () => {
    expect(hasRole('admin', 'viewer')).toBe(true);
    expect(hasRole('admin', 'analyst')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
  });

  it('analyst erfüllt viewer + analyst, nicht admin', () => {
    expect(hasRole('analyst', 'viewer')).toBe(true);
    expect(hasRole('analyst', 'analyst')).toBe(true);
    expect(hasRole('analyst', 'admin')).toBe(false);
  });

  it('viewer erfüllt nur viewer', () => {
    expect(hasRole('viewer', 'viewer')).toBe(true);
    expect(hasRole('viewer', 'analyst')).toBe(false);
  });

  it('agent zählt als viewer-Level', () => {
    expect(hasRole('agent', 'viewer')).toBe(true);
    expect(hasRole('agent', 'analyst')).toBe(false);
  });

  it('unbekannte/fehlende Rolle hat kein Level', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole('hacker', 'viewer')).toBe(false);
  });
});

describe('rbac.can', () => {
  it('can.act nur ab analyst', () => {
    expect(can.act('viewer')).toBe(false);
    expect(can.act('analyst')).toBe(true);
    expect(can.act('admin')).toBe(true);
  });
  it('can.admin nur admin', () => {
    expect(can.admin('analyst')).toBe(false);
    expect(can.admin('admin')).toBe(true);
  });
});
