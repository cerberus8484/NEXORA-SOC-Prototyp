import { describe, it, expect } from 'vitest';
import { canViewQRadar } from './pageGates';

// Server-side routes mirror (informational, enforcement is server-side):
//   QRadar: GET /qradar/* → analyst+ (authenticate + requireRole('analyst'))

describe('canViewQRadar', () => {
  it('returns true for admin', () => {
    expect(canViewQRadar('admin')).toBe(true);
  });

  it('returns true for engineer', () => {
    expect(canViewQRadar('engineer')).toBe(true);
  });

  it('returns true for analyst', () => {
    expect(canViewQRadar('analyst')).toBe(true);
  });

  it('returns false for viewer', () => {
    expect(canViewQRadar('viewer')).toBe(false);
  });

  it('returns false for undefined role', () => {
    expect(canViewQRadar(undefined)).toBe(false);
  });

  it('returns false for agent role', () => {
    expect(canViewQRadar('agent')).toBe(false);
  });
});
