// TDD RED-Phase: settingsApi — erweiterte PlatformSettings (Phase 2)
// Prüft, dass die drei neuen Security-Keys korrekt typisiert und über die
// bestehende platform-Settings-API transportiert werden.
// Kein Buffer-Import — läuft rein in Vitest (kein Node-Buffer nötig).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: 'ok' });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import {
  getPlatform,
  savePlatform,
  type PlatformSettings,
} from './settingsApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformSettings — neue Security-Keys im Typ', () => {
  test('PlatformSettings enthält passwordMinLength als number', () => {
    // Typ-Test: Kompilierung schlägt fehl wenn passwordMinLength fehlt.
    const s: PlatformSettings = {
      platformName:      'Test',
      defaultView:       'dashboard',
      timezone:          'Europe/Berlin',
      language:          'de',
      maintenanceMode:   false,
      betaFeatures:      false,
      passwordMinLength: 8,
      passwordComplexity: 'medium',
      sessionMaxHours:   8,
      lockoutMaxAttempts: 0,
      lockoutMinutes:     15,
      accentColor:       '#3b82f6',
    };
    expect(s.passwordMinLength).toBe(8);
    expect(s.passwordComplexity).toBe('medium');
    expect(s.sessionMaxHours).toBe(8);
  });

  test('passwordComplexity akzeptiert low | medium | high', () => {
    const low:    PlatformSettings['passwordComplexity'] = 'low';
    const medium: PlatformSettings['passwordComplexity'] = 'medium';
    const high:   PlatformSettings['passwordComplexity'] = 'high';
    expect(low).toBe('low');
    expect(medium).toBe('medium');
    expect(high).toBe('high');
  });
});

describe('getPlatform — packt data aus und leitet neue Keys durch', () => {
  test('ruft /settings/platform auf und gibt PlatformSettings zurück', async () => {
    const mockData: PlatformSettings = {
      platformName:       'Nexora',
      defaultView:        'dashboard',
      timezone:           'Europe/Berlin',
      language:           'de',
      maintenanceMode:    false,
      betaFeatures:       false,
      passwordMinLength:  12,
      passwordComplexity: 'high',
      sessionMaxHours:    4,
      lockoutMaxAttempts: 0,
      lockoutMinutes:     15,
      accentColor:        '#3b82f6',
    };
    mGet.mockResolvedValueOnce({ data: mockData });

    const result = await getPlatform();
    expect(mGet).toHaveBeenCalledWith('/settings/platform');
    expect(result.passwordMinLength).toBe(12);
    expect(result.passwordComplexity).toBe('high');
    expect(result.sessionMaxHours).toBe(4);
  });

  test('gibt Default-Werte weiter wenn Backend defaults liefert', async () => {
    const mockData: PlatformSettings = {
      platformName:       'Nexora',
      defaultView:        'dashboard',
      timezone:           'Europe/Berlin',
      language:           'de',
      maintenanceMode:    false,
      betaFeatures:       false,
      passwordMinLength:  8,
      passwordComplexity: 'medium',
      sessionMaxHours:    8,
      lockoutMaxAttempts: 0,
      lockoutMinutes:     15,
      accentColor:        '#3b82f6',
    };
    mGet.mockResolvedValueOnce({ data: mockData });

    const result = await getPlatform();
    expect(result.passwordMinLength).toBe(8);
    expect(result.passwordComplexity).toBe('medium');
    expect(result.sessionMaxHours).toBe(8);
  });
});

describe('savePlatform — sendet neue Keys mit', () => {
  test('PUT /settings/platform enthält alle drei neuen Keys', async () => {
    const settings: PlatformSettings = {
      platformName:       'SOC Platform',
      defaultView:        'dashboard',
      timezone:           'Europe/Berlin',
      language:           'de',
      maintenanceMode:    false,
      betaFeatures:       false,
      passwordMinLength:  14,
      passwordComplexity: 'high',
      sessionMaxHours:    6,
      lockoutMaxAttempts: 0,
      lockoutMinutes:     15,
      accentColor:        '#3b82f6',
    };
    mPut.mockResolvedValueOnce({ data: settings });

    const saved = await savePlatform(settings);
    expect(mPut).toHaveBeenCalledWith('/settings/platform', settings);
    expect(saved.passwordMinLength).toBe(14);
    expect(saved.passwordComplexity).toBe('high');
    expect(saved.sessionMaxHours).toBe(6);
  });

  test('savePlatform gibt das gespeicherte Objekt zurück', async () => {
    const updated: PlatformSettings = {
      platformName:       'SOC v2',
      defaultView:        'tickets',
      timezone:           'UTC',
      language:           'en',
      maintenanceMode:    false,
      betaFeatures:       true,
      passwordMinLength:  16,
      passwordComplexity: 'low',
      sessionMaxHours:    168,
      lockoutMaxAttempts: 5,
      lockoutMinutes:     30,
      accentColor:        '#ff0000',
    };
    mPut.mockResolvedValueOnce({ data: updated });

    const result = await savePlatform(updated);
    expect(result).toEqual(updated);
  });
});
