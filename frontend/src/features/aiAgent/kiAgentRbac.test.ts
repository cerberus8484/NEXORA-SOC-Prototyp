/**
 * Tests für kiAgentRbac — RBAC-Matrix für KI-Aktionen (read-only, keine Auto-Aktionen).
 * Keine Browser-API, kein Buffer, kein React — rein testbar.
 */
import { describe, it, expect } from 'vitest';
import {
  KI_ACTION_RBAC,
  canProposeKi,
  canApproveKi,
  canRejectKi,
  canConfigureKi,
  type KiActionRbacRow,
} from './kiAgentRbac';

describe('KI_ACTION_RBAC', () => {
  it('enthält Einträge für propose, approve, reject und configure', () => {
    const actions = KI_ACTION_RBAC.map((r) => r.action);
    expect(actions).toContain('propose');
    expect(actions).toContain('approve');
    expect(actions).toContain('reject');
    expect(actions).toContain('configure');
  });

  it('jeder Eintrag hat action, minRole, label und description', () => {
    KI_ACTION_RBAC.forEach((row: KiActionRbacRow) => {
      expect(row.action).toBeTruthy();
      expect(row.minRole).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(row.description).toBeTruthy();
    });
  });

  it('propose erfordert mindestens analyst', () => {
    const row = KI_ACTION_RBAC.find((r) => r.action === 'propose');
    expect(row?.minRole).toBe('analyst');
  });

  it('configure erfordert mindestens admin', () => {
    const row = KI_ACTION_RBAC.find((r) => r.action === 'configure');
    expect(row?.minRole).toBe('admin');
  });
});

describe('canProposeKi', () => {
  it('viewer darf nicht', () => expect(canProposeKi('viewer')).toBe(false));
  it('analyst darf', () => expect(canProposeKi('analyst')).toBe(true));
  it('engineer darf', () => expect(canProposeKi('engineer')).toBe(true));
  it('admin darf', () => expect(canProposeKi('admin')).toBe(true));
  it('undefined darf nicht', () => expect(canProposeKi(undefined)).toBe(false));
});

describe('canApproveKi', () => {
  it('viewer darf nicht', () => expect(canApproveKi('viewer')).toBe(false));
  it('analyst darf', () => expect(canApproveKi('analyst')).toBe(true));
  it('admin darf', () => expect(canApproveKi('admin')).toBe(true));
});

describe('canRejectKi', () => {
  it('viewer darf nicht', () => expect(canRejectKi('viewer')).toBe(false));
  it('analyst darf', () => expect(canRejectKi('analyst')).toBe(true));
  it('admin darf', () => expect(canRejectKi('admin')).toBe(true));
});

describe('canConfigureKi', () => {
  it('analyst darf nicht', () => expect(canConfigureKi('analyst')).toBe(false));
  it('engineer darf nicht', () => expect(canConfigureKi('engineer')).toBe(false));
  it('admin darf', () => expect(canConfigureKi('admin')).toBe(true));
  it('undefined darf nicht', () => expect(canConfigureKi(undefined)).toBe(false));
});
