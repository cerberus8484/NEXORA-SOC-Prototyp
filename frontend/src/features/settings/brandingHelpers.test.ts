// TDD RED-Phase: Hex-Validierungs-Helfer + savePlatform-Body für Branding
// Kein Buffer-Import — reiner Vitest/jsdom-Test ohne Node-APIs.

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Hex-Validierungs-Helfer ───────────────────────────────────────────────────

import { isValidHexColor, normalizeHexColor } from './brandingHelpers';

describe('isValidHexColor', () => {
  test('akzeptiert gültiges 6-stelliges Kleinbuchstaben-Hex', () => {
    expect(isValidHexColor('#3b82f6')).toBe(true);
  });

  test('akzeptiert gültiges 6-stelliges Großbuchstaben-Hex', () => {
    expect(isValidHexColor('#ABC123')).toBe(true);
  });

  test('akzeptiert gemischte Groß-/Kleinschreibung', () => {
    expect(isValidHexColor('#aAbBcC')).toBe(true);
  });

  test('akzeptiert alle Nullen (#000000)', () => {
    expect(isValidHexColor('#000000')).toBe(true);
  });

  test('akzeptiert alle Fs (#ffffff)', () => {
    expect(isValidHexColor('#ffffff')).toBe(true);
  });

  test('lehnt Hash-Prefix ohne Farbe ab', () => {
    expect(isValidHexColor('#')).toBe(false);
  });

  test('lehnt 3-stelliges Shorthand-Hex ab', () => {
    expect(isValidHexColor('#abc')).toBe(false);
  });

  test('lehnt Hex ohne Hash-Prefix ab', () => {
    expect(isValidHexColor('3b82f6')).toBe(false);
  });

  test('lehnt leeren String ab', () => {
    expect(isValidHexColor('')).toBe(false);
  });

  test('lehnt Hex mit ungültigen Zeichen ab', () => {
    expect(isValidHexColor('#gggggg')).toBe(false);
  });

  test('lehnt 7-stelliges Hex ab (zu lang)', () => {
    expect(isValidHexColor('#3b82f66')).toBe(false);
  });

  test('lehnt CSS-Farbnamen ab', () => {
    expect(isValidHexColor('red')).toBe(false);
  });

  test('lehnt rgba()-Wert ab', () => {
    expect(isValidHexColor('rgba(0,0,0,1)')).toBe(false);
  });
});

describe('normalizeHexColor', () => {
  test('gibt Hex-String unverändert zurück wenn gültig', () => {
    expect(normalizeHexColor('#3b82f6')).toBe('#3b82f6');
  });

  test('gibt ungültigen Wert als null zurück', () => {
    expect(normalizeHexColor('not-a-color')).toBeNull();
  });

  test('gibt leeren String als null zurück', () => {
    expect(normalizeHexColor('')).toBeNull();
  });

  test('gibt 3-stelliges Shorthand als null zurück', () => {
    expect(normalizeHexColor('#abc')).toBeNull();
  });
});

// ── savePlatform-Body-Vertrag für Branding-Panel ──────────────────────────────

vi.mock('../../lib/apiClient', () => {
  const make = () => vi.fn().mockResolvedValue({ data: {} });
  return { api: { get: make(), post: make(), put: make(), patch: make(), del: make() } };
});

import { api } from '../../lib/apiClient';
import { getPlatform, savePlatform, type PlatformSettings } from './settingsApi';

const mGet = api.get as ReturnType<typeof vi.fn>;
const mPut = api.put as ReturnType<typeof vi.fn>;

const BASE_SETTINGS: PlatformSettings = {
  platformName:       'Nexora SOC Platform',
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

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue({ data: BASE_SETTINGS });
  mPut.mockResolvedValue({ data: BASE_SETTINGS });
});

describe('getPlatform — liefert accentColor', () => {
  test('accentColor ist im Rückgabe-Typ enthalten', async () => {
    const result = await getPlatform();
    expect(Object.prototype.hasOwnProperty.call(result, 'accentColor')).toBe(true);
    expect(result.accentColor).toBe('#3b82f6');
  });

  test('accentColor wird korrekt aus data-Envelope ausgepackt', async () => {
    mGet.mockResolvedValueOnce({ data: { ...BASE_SETTINGS, accentColor: '#ff0000' } });
    const result = await getPlatform();
    expect(result.accentColor).toBe('#ff0000');
  });
});

describe('savePlatform — sendet accentColor im Body', () => {
  test('PUT-Body enthält accentColor', () => {
    const body: PlatformSettings = { ...BASE_SETTINGS, accentColor: '#aabbcc' };
    savePlatform(body);
    expect(mPut).toHaveBeenCalledWith('/settings/platform', expect.objectContaining({
      accentColor: '#aabbcc',
    }));
  });

  test('savePlatform gibt accentColor aus Antwort zurück', async () => {
    const updated: PlatformSettings = { ...BASE_SETTINGS, accentColor: '#112233' };
    mPut.mockResolvedValueOnce({ data: updated });
    const result = await savePlatform(updated);
    expect(result.accentColor).toBe('#112233');
  });

  test('savePlatform wirft bei HTTP-Fehler weiter (kein Silent-Fail)', async () => {
    mPut.mockRejectedValueOnce(new Error('403 Forbidden'));
    await expect(savePlatform(BASE_SETTINGS)).rejects.toThrow('403 Forbidden');
  });
});
