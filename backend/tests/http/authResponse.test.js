const { buildAuthSessionResponse, shouldReturnTokenInJson } = require('../../src/http/authResponse');

const user = { id: 'u1', email: 'a@nexora.test', role: 'analyst' };

describe('authResponse', () => {
  test('liefert Token in test/dev per Default fuer bestehende Bearer-Clients', () => {
    expect(shouldReturnTokenInJson({ NODE_ENV: 'test' })).toBe(true);
    expect(buildAuthSessionResponse({ token: 'jwt', user, requestId: 'r1' }, { NODE_ENV: 'test' }))
      .toMatchObject({ token: 'jwt', user, requestId: 'r1' });
  });

  test('unterdrueckt Token im JSON-Body in Produktion per Default', () => {
    const payload = buildAuthSessionResponse({ token: 'jwt', user, requestId: 'r1' }, { NODE_ENV: 'production' });
    expect(payload).toEqual({ user, requestId: 'r1' });
  });

  test('AUTH_RETURN_TOKEN_JSON=true ist expliziter Kompatibilitaetsmodus', () => {
    expect(shouldReturnTokenInJson({ NODE_ENV: 'production', AUTH_RETURN_TOKEN_JSON: 'true' })).toBe(true);
    expect(shouldReturnTokenInJson({ NODE_ENV: 'test', AUTH_RETURN_TOKEN_JSON: 'false' })).toBe(false);
  });

  test('Recovery-Codes bleiben erhalten, ohne den Session-Token erzwingen zu muessen', () => {
    const payload = buildAuthSessionResponse({
      token: 'jwt',
      user,
      recoveryCodes: ['ABCD-EFGH'],
      requestId: 'r1',
    }, { NODE_ENV: 'production' });
    expect(payload).toEqual({ user, recoveryCodes: ['ABCD-EFGH'], requestId: 'r1' });
  });
});
