'use strict';

const { base32Encode, base32Decode, generateSecret, totpToken, verifyToken, otpauthUri } = require('../../src/mfa/totp');

// RFC 6238 Appendix B: Seed (ASCII) "12345678901234567890" → Base32 (RFC 4648).
const RFC_SEED_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SEED_ASCII));

describe('Base32 (RFC 4648)', () => {
  it('kodiert den RFC-Seed zum bekannten Base32-Wert', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('Encode→Decode ist verlustfrei', () => {
    const buf = Buffer.from('Nexora-SOC-MFA-Test!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('lehnt ungültige Base32-Zeichen ab', () => {
    expect(() => base32Decode('NOT_VALID_1890')).toThrow();
  });
});

describe('TOTP gegen offizielle RFC-6238-Testvektoren (SHA1, 8-stellig)', () => {
  const VECTORS = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(VECTORS)('time=%i → %s', (time, expected) => {
    expect(totpToken(RFC_SECRET_B32, { time, digits: 8, algorithm: 'sha1' })).toBe(expected);
  });

  it('liefert Default 6-stellige Codes', () => {
    expect(totpToken(RFC_SECRET_B32, { time: 59 })).toHaveLength(6);
  });
});

describe('verifyToken', () => {
  it('akzeptiert den aktuell gültigen Code', () => {
    const code = totpToken(RFC_SECRET_B32, { time: 1000 });
    expect(verifyToken(RFC_SECRET_B32, code, { time: 1000 })).toBe(true);
  });

  it('akzeptiert innerhalb der Drift-Toleranz (±1 Schritt)', () => {
    const code = totpToken(RFC_SECRET_B32, { time: 1000 });
    expect(verifyToken(RFC_SECRET_B32, code, { time: 1000 + 29 })).toBe(true);
  });

  it('lehnt ausserhalb des Fensters ab', () => {
    const code = totpToken(RFC_SECRET_B32, { time: 1000 });
    expect(verifyToken(RFC_SECRET_B32, code, { time: 1000 + 120 })).toBe(false);
  });

  it('lehnt falsche und nicht-numerische Eingaben ab', () => {
    expect(verifyToken(RFC_SECRET_B32, '000000', { time: 1000 })).toBe(false);
    expect(verifyToken(RFC_SECRET_B32, 'abcdef', { time: 1000 })).toBe(false);
    expect(verifyToken(RFC_SECRET_B32, '', { time: 1000 })).toBe(false);
  });
});

describe('Secret & otpauth-URI', () => {
  it('generateSecret liefert ein dekodierbares 20-Byte-Secret', () => {
    const s = generateSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(verifyToken(s, totpToken(s, { time: 500 }), { time: 500 })).toBe(true);
  });

  it('otpauthUri enthält Secret + Issuer + Standardparameter', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', { label: 'analyst@nexora.example', issuer: 'Nexora SOC' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Nexora+SOC');
    expect(uri).toContain('period=30');
  });
});
