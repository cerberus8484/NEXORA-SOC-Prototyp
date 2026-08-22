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

  test('leere Eingabe → Fehlermeldung', () => {
    expect(validateMfaCode('')).toMatch(/eingeben/i);
    expect(validateMfaCode('   ')).toMatch(/eingeben/i);
  });

  test('zu kurz → Fehlermeldung', () => {
    expect(validateMfaCode('123')).toMatch(/Code/i);
  });

  test('unzulässige Zeichen → Fehlermeldung', () => {
    expect(validateMfaCode('12345!')).toMatch(/Code/i);
  });
});
