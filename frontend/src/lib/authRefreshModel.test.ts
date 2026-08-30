import { describe, test, expect } from 'vitest';
import { ApiError } from './apiClient';
import { shouldClearAuthOnRefreshError } from './authRefreshModel';

describe('shouldClearAuthOnRefreshError', () => {
  test('echtes 401 → true (Session weg, ausloggen)', () => {
    expect(shouldClearAuthOnRefreshError(new ApiError('Nicht authentifiziert', 401, 'UNAUTHORIZED'))).toBe(true);
  });

  test('Netzwerkfehler (Status 0) → false (User-State behalten)', () => {
    expect(shouldClearAuthOnRefreshError(new ApiError('Netzwerkfehler', 0, 'NETWORK'))).toBe(false);
  });

  test('Serverfehler 500 → false (kein Auslogg bei Backend-Hänger)', () => {
    expect(shouldClearAuthOnRefreshError(new ApiError('HTTP 500', 500, 'ERROR'))).toBe(false);
  });

  test('403 → false (Berechtigung, nicht Authentifizierung)', () => {
    expect(shouldClearAuthOnRefreshError(new ApiError('Forbidden', 403, 'FORBIDDEN'))).toBe(false);
  });

  test('generischer Error (kein ApiError) → false', () => {
    expect(shouldClearAuthOnRefreshError(new Error('boom'))).toBe(false);
  });

  test('undefined / nicht-Error → false', () => {
    expect(shouldClearAuthOnRefreshError(undefined)).toBe(false);
    expect(shouldClearAuthOnRefreshError('weird')).toBe(false);
  });
});
