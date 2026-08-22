import { describe, test, expect } from 'vitest';
import { validatePasswordChange } from './passwordChangeModel';

describe('validatePasswordChange', () => {
  test('gültig → null', () => {
    expect(validatePasswordChange('OldPass1!', 'NewPass99!', 'NewPass99!')).toBeNull();
  });

  test('fehlende Eingabe', () => {
    expect(validatePasswordChange('', 'NewPass99!', 'NewPass99!')).toMatch(/eingeben/);
    expect(validatePasswordChange('OldPass1!', '', '')).toMatch(/eingeben/);
  });

  test('zu kurz', () => {
    expect(validatePasswordChange('OldPass1!', 'kurz', 'kurz')).toMatch(/8 Zeichen/);
  });

  test('Bestätigung weicht ab', () => {
    expect(validatePasswordChange('OldPass1!', 'NewPass99!', 'Anders99!')).toMatch(/stimmen nicht/);
  });

  test('gleich wie aktuell', () => {
    expect(validatePasswordChange('SamePass1!', 'SamePass1!', 'SamePass1!')).toMatch(/unterscheiden/);
  });
});
