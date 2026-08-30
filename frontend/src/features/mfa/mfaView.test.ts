import { describe, test, expect } from 'vitest';
import {
  mfaStatusLabel,
  mfaStatusTone,
  isMfaActive,
  formatRecoveryCodes,
  recoveryCodesText,
  isValidTotpToken,
  isValidDisableCode,
  recoveryRemainingTone,
  nextEnrollStep,
  type EnrollStep,
} from './mfaView';

describe('mfaStatusLabel', () => {
  test('none → „Nicht eingerichtet“', () => {
    expect(mfaStatusLabel('none')).toBe('Nicht eingerichtet');
  });
  test('pending → „Einrichtung offen“', () => {
    expect(mfaStatusLabel('pending')).toBe('Einrichtung offen');
  });
  test('active → „Aktiv“', () => {
    expect(mfaStatusLabel('active')).toBe('Aktiv');
  });
  test('disabled → „Deaktiviert“', () => {
    expect(mfaStatusLabel('disabled')).toBe('Deaktiviert');
  });
});

describe('mfaStatusTone', () => {
  test('active → success', () => {
    expect(mfaStatusTone('active')).toBe('success');
  });
  test('pending → warning', () => {
    expect(mfaStatusTone('pending')).toBe('warning');
  });
  test('none → muted', () => {
    expect(mfaStatusTone('none')).toBe('muted');
  });
  test('disabled → muted', () => {
    expect(mfaStatusTone('disabled')).toBe('muted');
  });
});

describe('isMfaActive', () => {
  test('active → true', () => {
    expect(isMfaActive('active')).toBe(true);
  });
  test('alle anderen → false', () => {
    expect(isMfaActive('none')).toBe(false);
    expect(isMfaActive('pending')).toBe(false);
    expect(isMfaActive('disabled')).toBe(false);
  });
});

describe('isValidTotpToken', () => {
  test('genau 6 Ziffern → gültig', () => {
    expect(isValidTotpToken('123456')).toBe(true);
    expect(isValidTotpToken('000000')).toBe(true);
  });
  test('Whitespace wird ignoriert', () => {
    expect(isValidTotpToken(' 123 456 ')).toBe(true);
  });
  test('zu kurz/zu lang → ungültig', () => {
    expect(isValidTotpToken('12345')).toBe(false);
    expect(isValidTotpToken('1234567')).toBe(false);
  });
  test('Buchstaben → ungültig', () => {
    expect(isValidTotpToken('12a456')).toBe(false);
  });
  test('leer → ungültig', () => {
    expect(isValidTotpToken('')).toBe(false);
  });
});

describe('isValidDisableCode', () => {
  test('6-stelliger TOTP-Code → gültig', () => {
    expect(isValidDisableCode('123456')).toBe(true);
  });
  test('Recovery-Code (mit Bindestrich) → gültig', () => {
    expect(isValidDisableCode('ABCD-EFGH')).toBe(true);
  });
  test('leer/zu kurz → ungültig', () => {
    expect(isValidDisableCode('')).toBe(false);
    expect(isValidDisableCode('   ')).toBe(false);
    expect(isValidDisableCode('ab')).toBe(false);
  });
});

describe('formatRecoveryCodes', () => {
  test('gibt eine Kopie zurück (keine Mutation der Eingabe)', () => {
    const input = ['AAAA-BBBB', 'CCCC-DDDD'];
    const out = formatRecoveryCodes(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
  test('verwirft leere/whitespace-Einträge', () => {
    expect(formatRecoveryCodes(['AAAA', '', '   ', 'BBBB'])).toEqual(['AAAA', 'BBBB']);
  });
  test('leere Liste → leere Liste', () => {
    expect(formatRecoveryCodes([])).toEqual([]);
  });
});

describe('recoveryCodesText', () => {
  test('je Code eine Zeile', () => {
    expect(recoveryCodesText(['AAAA-BBBB', 'CCCC-DDDD'])).toBe('AAAA-BBBB\nCCCC-DDDD');
  });
  test('leere Liste → leerer String', () => {
    expect(recoveryCodesText([])).toBe('');
  });
});

describe('recoveryRemainingTone', () => {
  test('0 verbleibend → danger', () => {
    expect(recoveryRemainingTone(0, 10)).toBe('danger');
  });
  test('niedrig (<=2) → warning', () => {
    expect(recoveryRemainingTone(2, 10)).toBe('warning');
  });
  test('genug → success', () => {
    expect(recoveryRemainingTone(8, 10)).toBe('success');
  });
  test('undefined → muted', () => {
    expect(recoveryRemainingTone(undefined, undefined)).toBe('muted');
  });
});

describe('nextEnrollStep', () => {
  test('idle --enroll--> showSecret', () => {
    expect(nextEnrollStep('idle', 'enroll')).toBe('showSecret');
  });
  test('showSecret --verify--> verifying', () => {
    expect(nextEnrollStep('showSecret', 'verify')).toBe('verifying');
  });
  test('verifying --verified--> done', () => {
    expect(nextEnrollStep('verifying', 'verified')).toBe('done');
  });
  test('verifying --fail--> showSecret (zurück zur Code-Eingabe)', () => {
    expect(nextEnrollStep('verifying', 'fail')).toBe('showSecret');
  });
  test('cancel von überall → idle', () => {
    const steps: EnrollStep[] = ['idle', 'showSecret', 'verifying', 'done'];
    for (const s of steps) expect(nextEnrollStep(s, 'cancel')).toBe('idle');
  });
  test('unbekannter Übergang lässt den Schritt unverändert', () => {
    expect(nextEnrollStep('idle', 'verify')).toBe('idle');
  });
});
