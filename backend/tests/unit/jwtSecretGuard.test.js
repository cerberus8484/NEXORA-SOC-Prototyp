'use strict';

const { resolveBcryptRounds, resolveJwtSecret } = require('../../src/services/AuthService');

describe('resolveJwtSecret() — Startup-Guard', () => {
  it('production + kein Secret → wirft (kein stiller Fallback)', () => {
    expect(() => resolveJwtSecret({ secret: undefined, nodeEnv: 'production' }))
      .toThrow(/JWT_SECRET/);
  });

  it('production + zu kurzes Secret (<32) → wirft', () => {
    expect(() => resolveJwtSecret({ secret: 'short', nodeEnv: 'production' }))
      .toThrow(/JWT_SECRET/);
  });

  it('production + gültiges Secret (>=32) → gibt Secret zurück', () => {
    const s = 'a'.repeat(32);
    expect(resolveJwtSecret({ secret: s, nodeEnv: 'production' })).toBe(s);
  });

  it('development + kein Secret → Dev-Fallback (kein Wurf)', () => {
    const out = resolveJwtSecret({ secret: undefined, nodeEnv: 'development' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThanOrEqual(32);
  });

  it('development + eigenes Secret → nutzt das eigene', () => {
    expect(resolveJwtSecret({ secret: 'my-dev-secret', nodeEnv: 'development' }))
      .toBe('my-dev-secret');
  });
});

describe('resolveBcryptRounds() — Startup-Guard', () => {
  it('test + kein Override → nutzt schnelle Test-Rounds', () => {
    expect(resolveBcryptRounds({ rounds: undefined, nodeEnv: 'test' })).toBe(4);
  });

  it('production + kein Override → nutzt sicheren Default', () => {
    expect(resolveBcryptRounds({ rounds: undefined, nodeEnv: 'production' })).toBe(12);
  });

  it('production + zu niedrige Rounds → wirft', () => {
    expect(() => resolveBcryptRounds({ rounds: '4', nodeEnv: 'production' }))
      .toThrow(/BCRYPT_ROUNDS/);
  });

  it('ungültige Rounds → wirft', () => {
    expect(() => resolveBcryptRounds({ rounds: 'abc', nodeEnv: 'test' }))
      .toThrow(/BCRYPT_ROUNDS/);
  });
});
