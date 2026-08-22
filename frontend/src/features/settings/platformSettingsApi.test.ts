// TDD RED-Phase: Vertrags-Tests für getPlatform / savePlatform
// Kein Buffer, kein @types/node (Web-Build-Constraint).

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {} });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { getPlatform, savePlatform, type PlatformSettings } from './settingsApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;

const DEFAULT_PLATFORM: PlatformSettings = {
  platformName:       'Nexora SOC Platform',
  defaultView:        'dashboard',
  timezone:           'Europe/Berlin',
  language:           'de',
  maintenanceMode:    false,
  betaFeatures:       false,
  // Phase 2: Security-Keys mit Defaults
  passwordMinLength:  8,
  passwordComplexity: 'medium',
  sessionMaxHours:    8,
  // Account-Lockout
  lockoutMaxAttempts: 0,
  lockoutMinutes:     15,
  // Branding
  accentColor:        '#3b82f6',
};

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: DEFAULT_PLATFORM });
  mPut.mockResolvedValue({ data: DEFAULT_PLATFORM });
});

describe('getPlatform', () => {
  test('trifft GET /settings/platform ohne Query', () => {
    getPlatform();
    expect(mGet).toHaveBeenCalledWith('/settings/platform');
  });

  test('gibt die data-Payload aus dem Envelope zurück', async () => {
    const result = await getPlatform();
    expect(result.platformName).toBe('Nexora SOC Platform');
    expect(result.maintenanceMode).toBe(false);
  });

  test('liefert alle PLATFORM_KEYS im Rückgabetyp', async () => {
    const result = await getPlatform();
    const keys: (keyof PlatformSettings)[] = [
      'platformName', 'defaultView', 'timezone', 'language', 'maintenanceMode', 'betaFeatures',
      'passwordMinLength', 'passwordComplexity', 'sessionMaxHours',
    ];
    for (const key of keys) {
      // Nur prüfen dass der Key definiert ist (0 und false sind gültige Werte)
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    }
  });
});

describe('savePlatform', () => {
  test('trifft PUT /settings/platform mit Body', () => {
    const body: PlatformSettings = {
      platformName: 'Test', defaultView: 'tickets', timezone: 'UTC', language: 'en',
      maintenanceMode: false, betaFeatures: false,
      passwordMinLength: 8, passwordComplexity: 'medium', sessionMaxHours: 8,
      lockoutMaxAttempts: 0, lockoutMinutes: 15,
      accentColor: '#3b82f6',
    };
    savePlatform(body);
    expect(mPut).toHaveBeenCalledWith('/settings/platform', body);
  });

  test('gibt die gespeicherten Werte (data-Payload) zurück', async () => {
    mPut.mockResolvedValueOnce({ data: { ...DEFAULT_PLATFORM, platformName: 'Saved Name' } });
    const result = await savePlatform({ ...DEFAULT_PLATFORM, platformName: 'Saved Name' });
    expect(result.platformName).toBe('Saved Name');
  });

  test('wirft bei HTTP-Fehler (Promise rejected) weiter', async () => {
    mPut.mockRejectedValueOnce(new Error('403 Forbidden'));
    await expect(savePlatform(DEFAULT_PLATFORM)).rejects.toThrow('403 Forbidden');
  });
});

describe('PlatformSettings Typ-Vertrag', () => {
  test('defaultView ist eines der erlaubten Enum-Werte im Typ', async () => {
    mGet.mockResolvedValueOnce({ data: { ...DEFAULT_PLATFORM, defaultView: 'hunts' } });
    const result = await getPlatform();
    // Typ-Check: 'hunts' ist ein gültiger defaultView
    const view: 'dashboard' | 'tickets' | 'hunts' = result.defaultView;
    expect(view).toBe('hunts');
  });

  test('language ist eines der erlaubten Enum-Werte im Typ', async () => {
    mGet.mockResolvedValueOnce({ data: { ...DEFAULT_PLATFORM, language: 'en' } });
    const result = await getPlatform();
    const lang: 'de' | 'en' = result.language;
    expect(lang).toBe('en');
  });
});
