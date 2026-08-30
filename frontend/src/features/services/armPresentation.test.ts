import { describe, test, expect } from 'vitest';
import { armSourceLabel, deriveArmView } from './armPresentation';
import type { ManagedService } from './servicesApi';

function mkService(over: Partial<ManagedService> = {}): ManagedService {
  return {
    id: 'wazuh-manager',
    name: 'Wazuh Manager',
    description: 'x',
    category: 'SIEM',
    armed: false,
    armSource: null,
    connection: { configured: false, apiConfigured: false, indexerConfigured: false },
    restart: { supported: true, enabled: false, disabledReason: 'Nicht scharfgeschaltet' },
    ...over,
  };
}

describe('armSourceLabel — Herkunft der Scharfschaltung', () => {
  test('env → "per Konfiguration (ENV)"', () => {
    expect(armSourceLabel('env')).toContain('ENV');
  });
  test('ui → "per UI"', () => {
    expect(armSourceLabel('ui')).toContain('UI');
  });
  test('null → nicht scharfgeschaltet', () => {
    expect(armSourceLabel(null).toLowerCase()).toContain('nicht');
  });
});

describe('deriveArmView — ehrliche Karten-Anzeige', () => {
  test('nicht scharf → Scharfschalten anbieten, kein Entschärfen, kein Restart', () => {
    const v = deriveArmView(mkService({ armed: false, armSource: null }));
    expect(v.showArm).toBe(true);
    expect(v.showDisarm).toBe(false);
    expect(v.canRestart).toBe(false);
    expect(v.armBadgeTone).toBe('muted');
    expect(v.restartBlockedReason).toBe('Nicht scharfgeschaltet');
  });

  test('per UI scharf + API konfiguriert → Entschärfen + Restart, kein Scharfschalten', () => {
    const v = deriveArmView(mkService({
      armed: true, armSource: 'ui',
      restart: { supported: true, enabled: true, disabledReason: null },
    }));
    expect(v.showArm).toBe(false);
    expect(v.showDisarm).toBe(true);
    expect(v.canRestart).toBe(true);
    expect(v.armBadgeTone).toBe('success');
    expect(v.restartBlockedReason).toBeNull();
  });

  test('per ENV scharf → KEIN Entschärfen-Button (UI kann ENV nicht abschalten)', () => {
    const v = deriveArmView(mkService({
      armed: true, armSource: 'env',
      restart: { supported: true, enabled: true, disabledReason: null },
    }));
    expect(v.showDisarm).toBe(false);
    expect(v.showArm).toBe(false);
    expect(v.canRestart).toBe(true);
  });

  test('scharf aber Wazuh-API NICHT konfiguriert → kein Restart, ehrlicher Grund', () => {
    const v = deriveArmView(mkService({
      armed: true, armSource: 'ui',
      restart: { supported: true, enabled: false, disabledReason: 'Wazuh-API nicht konfiguriert' },
    }));
    expect(v.canRestart).toBe(false);
    expect(v.restartBlockedReason).toBe('Wazuh-API nicht konfiguriert');
    // Entschärfen bleibt möglich (per UI scharf).
    expect(v.showDisarm).toBe(true);
  });
});
