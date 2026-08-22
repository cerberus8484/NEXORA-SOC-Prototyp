import { describe, it, expect } from 'vitest';
import { hasSsoError, OIDC_LOGIN_URL } from './oidcLogin';

describe('hasSsoError', () => {
  it('erkennt ?sso_error=1', () => {
    expect(hasSsoError('?sso_error=1')).toBe(true);
    expect(hasSsoError('?foo=bar&sso_error=1')).toBe(true);
  });

  it('ist false ohne den Parameter', () => {
    expect(hasSsoError('')).toBe(false);
    expect(hasSsoError('?foo=bar')).toBe(false);
    expect(hasSsoError('?sso_error=0')).toBe(false);
    expect(hasSsoError('?sso_error=')).toBe(false);
  });
});

describe('OIDC_LOGIN_URL', () => {
  it('zeigt auf den Backend-SSO-Login-Endpunkt', () => {
    expect(OIDC_LOGIN_URL).toMatch(/\/auth\/oidc\/login$/);
  });
});
