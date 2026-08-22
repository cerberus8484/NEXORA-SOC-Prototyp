import { describe, test, expect } from 'vitest';
import { apiErrorText } from './apiErrorText';
import { ApiError } from './apiClient';

describe('apiErrorText', () => {
  test('bevorzugt die strukturierten errors aus dem Body (statt HTTP 422)', () => {
    const err = new ApiError('HTTP 422', 422, 'ERROR', 'req-1', [
      'Agent-scoped Ausnahme ohne verifizierbaren Selector (hostname fehlt) — Apply blockiert.',
    ]);
    expect(apiErrorText(err)).toMatch(/ohne verifizierbaren Selector/);
    expect(apiErrorText(err)).not.toBe('HTTP 422');
  });

  test('mehrere errors werden verbunden', () => {
    const err = new ApiError('HTTP 400', 400, 'ERROR', undefined, ['A fehlt', 'B ungültig']);
    expect(apiErrorText(err)).toBe('A fehlt · B ungültig');
  });

  test('ohne errors fällt es auf die Message zurück', () => {
    const err = new ApiError('Nicht authentifiziert', 401);
    expect(apiErrorText(err)).toBe('Nicht authentifiziert');
  });

  test('leere errors-Liste → Message/Fallback', () => {
    const err = new ApiError('HTTP 422', 422, 'ERROR', undefined, []);
    expect(apiErrorText(err, 'Standard')).toBe('HTTP 422');
  });

  test('normaler Error → Message', () => {
    expect(apiErrorText(new Error('kaputt'))).toBe('kaputt');
  });

  test('unbekannter Wert → Fallback', () => {
    expect(apiErrorText(null, 'Standard')).toBe('Standard');
    expect(apiErrorText(undefined)).toBe('Aktion fehlgeschlagen');
  });
});
