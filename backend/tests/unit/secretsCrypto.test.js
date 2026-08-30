'use strict';

// Verschlüsselung für at-rest Secrets (Cloud-API-Keys). Round-trip + Tamper-Schutz.

const ORIG = process.env.SETTINGS_ENC_KEY;
beforeAll(() => { process.env.SETTINGS_ENC_KEY = 'test-encryption-key-min-16-chars-long'; });
afterAll(() => { if (ORIG === undefined) delete process.env.SETTINGS_ENC_KEY; else process.env.SETTINGS_ENC_KEY = ORIG; });

// Modul nach dem Setzen des ENV laden (Key wird pro Aufruf abgeleitet → ok auch so).
const { encryptSecret, decryptSecret, isEncrypted } = require('../../src/config/secretsCrypto');

describe('secretsCrypto', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const secret = 'sk-ant-supergeheim-1234567890';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);          // Klartext nicht enthalten
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('leerer Wert → leerer String (nichts zu verschlüsseln)', () => {
    expect(encryptSecret('')).toBe('');
    expect(encryptSecret(null)).toBe('');
  });

  it('zwei Verschlüsselungen desselben Werts unterscheiden sich (IV)', () => {
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'));
  });

  it('nicht-verschlüsselte Werte werden unverändert zurückgegeben', () => {
    expect(decryptSecret('klartext')).toBe('klartext');
    expect(isEncrypted('klartext')).toBe(false);
  });

  it('manipulierter Ciphertext → leerer String (kein Crash, GCM-Tag schlägt fehl)', () => {
    const enc = encryptSecret('geheim');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(decryptSecret(tampered)).toBe('');
  });
});
