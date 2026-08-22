import { describe, test, expect } from 'vitest';
import { preflightStatus, primaryAction } from './deployPreflightView';
import type { DeployPreflight } from './deployApi';

const pf = (over: Partial<DeployPreflight> = {}): DeployPreflight => ({
  effectiveEnabled: false, state: 'disarmed', canArm: true, blockers: [], checks: [], ...over,
});

describe('preflightStatus — anzeigbarer Zustand', () => {
  test('armed → grüner, scharfer Zustand', () => {
    const s = preflightStatus(pf({ state: 'armed', effectiveEnabled: true }));
    expect(s.tone).toBe('success');
    expect(s.label).toMatch(/scharf/i);
  });

  test('disarmed → neutral/warnend, aber betriebsbereit', () => {
    const s = preflightStatus(pf({ state: 'disarmed' }));
    expect(s.tone).toBe('warning');
    expect(s.label).toMatch(/inert|entwaffnet|bereit/i);
  });

  test('not_commissioned → gesperrt, Operator-Ebene', () => {
    const s = preflightStatus(pf({ state: 'not_commissioned', canArm: false }));
    expect(s.tone).toBe('danger');
    expect(s.label).toMatch(/kommission|operator|gesperrt/i);
  });
});

describe('primaryAction — welcher Toggle-Button', () => {
  test('armed → Entwaffnen anbieten', () => {
    expect(primaryAction(pf({ state: 'armed', effectiveEnabled: true })).kind).toBe('disarm');
  });

  test('disarmed + canArm → Scharfschalten anbieten', () => {
    expect(primaryAction(pf({ state: 'disarmed', canArm: true })).kind).toBe('arm');
  });

  test('disarmed aber Voraussetzungen offen → kein Arm-Button (nur Hinweis)', () => {
    const a = primaryAction(pf({ state: 'disarmed', canArm: false, blockers: ['x'] }));
    expect(a.kind).toBe('none');
    expect(a.disabledReason).toBeTruthy();
  });

  test('not_commissioned → kein Button, Operator-Hinweis', () => {
    const a = primaryAction(pf({ state: 'not_commissioned', canArm: false }));
    expect(a.kind).toBe('none');
    expect(a.disabledReason).toMatch(/operator|env|kommission/i);
  });
});
