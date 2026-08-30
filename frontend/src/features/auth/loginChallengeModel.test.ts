import { describe, test, expect } from 'vitest';
import { normalizeMfaCode, validateMfaCode } from './loginChallengeModel';

describe('normalizeMfaCode', () => {
  test('entfernt Leerzeichen und Bindestriche aus TOTP-Codes', () => {
    expect(normalizeMfaCode(' 123 456 ')).toBe('123456');
    expect(normalizeMfaCode('123-456')).toBe('123456');
  });

  test('macht Recovery-Codes groß und entfernt umgebenden Whitespace', () => {
    expect(normalizeMfaCode('  abcd-efgh  ')).toBe('ABCDEFGH');
  });

  test('leere Eingabe bleibt leer', () => {
    expect(normalizeMfaCode('')).toBe('');
    expect(normalizeMfaCode('   ')).toBe('');
  });
});

describe('validateMfaCode', () => {
  test('akzeptiert 6-stelligen TOTP-Code → null', () => {
    expect(validateMfaCode('123456')).toBeNull();
  });

  test('akzeptiert 6-stelligen TOTP-Code mit Trennzeichen → null', () => {
    expect(validateMfaCode('123 456')).toBeNull();
  });

  test('akzeptiert Recovery-Code (8 alphanumerische Zeichen) → null', () => {
    expect(validateMfaCode('ABCD1234')).toBeNull();
    expect(validateMfaCode('abcd-efgh')).toBeNull();
  });

  // Die Validierung liefert Übersetzungs-Schlüssel, keine fertigen Sätze — sonst
  // stünde deutscher Text in einem englischen UI. Tests prüfen deshalb den Schlüssel
  // und nicht die Formulierung; das ist auch stabiler gegen Textänderungen.
  test('leere Eingabe → Schlüssel für fehlende Eingabe', () => {
    expect(validateMfaCode('')).toEqual({ key: 'validation.mfaCodeRequired' });
    expect(validateMfaCode('   ')).toEqual({ key: 'validation.mfaCodeRequired' });
  });

  test('zu kurz → Schlüssel mit Mindestlänge als Parameter', () => {
    expect(validateMfaCode('123')).toEqual({ key: 'validation.mfaCodeTooShort', params: { min: 6 } });
  });

  test('unzulässige Zeichen → eigener Schlüssel', () => {
    expect(validateMfaCode('12345!')).toEqual({ key: 'validation.mfaCodeInvalidChars' });
  });
});
