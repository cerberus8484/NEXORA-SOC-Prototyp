'use strict';

const { MfaEnrollment } = require('../../src/domain/MfaEnrollment');

// Sicherheits-Invarianten (per Test erzwungen):
//   - secretEnc (verschlüsseltes TOTP-Secret) NIE in toJSON
//   - Recovery-Codes nur als SHA-256-Hash gespeichert, Klartext EINMALIG bei activate()
//   - State-Machine: pending → active → disabled (keine Rücksprünge)

describe('MfaEnrollment — Domäne', () => {
  const baseArgs = { userId: 'user-1', secretEnc: 'enc:v1:abc' };

  describe('create()', () => {
    test('startet im Status pending mit verschlüsseltem Secret', () => {
      const e = MfaEnrollment.create(baseArgs);
      expect(e.status).toBe('pending');
      expect(e.userId).toBe('user-1');
      expect(e.secretEnc).toBe('enc:v1:abc');
      expect(e.activatedAt).toBeNull();
      expect(e.recoveryCodes).toEqual([]);
    });

    test('wirft ohne userId', () => {
      expect(() => MfaEnrollment.create({ secretEnc: 'x' })).toThrow(/userId/);
    });

    test('wirft ohne secretEnc', () => {
      expect(() => MfaEnrollment.create({ userId: 'u' })).toThrow(/secret/i);
    });
  });

  describe('activate()', () => {
    test('pending → active, setzt activatedAt und gibt Recovery-Codes EINMALIG im Klartext zurück', () => {
      const e = MfaEnrollment.create(baseArgs);
      const codes = e.activate();
      expect(e.status).toBe('active');
      expect(typeof e.activatedAt).toBe('string');
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThanOrEqual(8);
      // Klartext-Codes sind NICHT im gespeicherten Objekt
      for (const plain of codes) {
        expect(e.recoveryCodes.some(r => r.hash === plain)).toBe(false);
      }
      // gespeichert wird nur Hash + usedAt
      expect(e.recoveryCodes.every(r => typeof r.hash === 'string' && r.usedAt === null)).toBe(true);
    });

    test('Recovery-Codes sind eindeutig', () => {
      const e = MfaEnrollment.create(baseArgs);
      const codes = e.activate();
      expect(new Set(codes).size).toBe(codes.length);
    });

    test('wirft bei doppelter Aktivierung (active → active verboten)', () => {
      const e = MfaEnrollment.create(baseArgs);
      e.activate();
      expect(() => e.activate()).toThrow(/pending/i);
    });
  });

  describe('consumeRecoveryCode()', () => {
    test('akzeptiert gültigen Code genau einmal', () => {
      const e = MfaEnrollment.create(baseArgs);
      const [code] = e.activate();
      expect(e.consumeRecoveryCode(code)).toBe(true);
      // zweiter Versuch mit demselben Code schlägt fehl
      expect(e.consumeRecoveryCode(code)).toBe(false);
    });

    test('ist tolerant gegenüber Formatierung (Groß/Klein, Bindestriche)', () => {
      const e = MfaEnrollment.create(baseArgs);
      const [code] = e.activate();
      const messy = code.toUpperCase().replace(/-/g, ' - ');
      expect(e.consumeRecoveryCode(messy)).toBe(true);
    });

    test('lehnt unbekannten Code ab', () => {
      const e = MfaEnrollment.create(baseArgs);
      e.activate();
      expect(e.consumeRecoveryCode('nicht-existent')).toBe(false);
    });

    test('reduziert remainingRecoveryCodes', () => {
      const e = MfaEnrollment.create(baseArgs);
      const codes = e.activate();
      const before = e.remainingRecoveryCodes;
      e.consumeRecoveryCode(codes[0]);
      expect(e.remainingRecoveryCodes).toBe(before - 1);
    });
  });

  describe('disable()', () => {
    test('active → disabled, setzt disabledAt', () => {
      const e = MfaEnrollment.create(baseArgs);
      e.activate();
      e.disable();
      expect(e.status).toBe('disabled');
      expect(typeof e.disabledAt).toBe('string');
    });

    test('pending → disabled erlaubt (Abbruch vor Verifizierung)', () => {
      const e = MfaEnrollment.create(baseArgs);
      e.disable();
      expect(e.status).toBe('disabled');
    });
  });

  describe('isActive', () => {
    test('nur im Status active true', () => {
      const e = MfaEnrollment.create(baseArgs);
      expect(e.isActive).toBe(false);
      e.activate();
      expect(e.isActive).toBe(true);
      e.disable();
      expect(e.isActive).toBe(false);
    });
  });

  describe('toJSON() — SICHERHEIT', () => {
    test('gibt NIEMALS secretEnc oder Recovery-Hashes aus', () => {
      const e = MfaEnrollment.create(baseArgs);
      e.activate();
      const json = e.toJSON();
      const serialized = JSON.stringify(json);
      expect(serialized).not.toContain('enc:v1:');
      expect(json.secretEnc).toBeUndefined();
      expect(json.recoveryCodes).toBeUndefined();
      // exponiert nur sichere Metadaten
      expect(json.status).toBe('active');
      expect(json.recoveryCodesRemaining).toBeGreaterThan(0);
    });
  });

  describe('fromRow()', () => {
    test('rekonstruiert aus DB-Zeile (snake_case)', () => {
      const e = MfaEnrollment.fromRow({
        id: 'm1',
        user_id: 'user-9',
        status: 'active',
        secret_enc: 'enc:v1:zzz',
        recovery_codes: [{ hash: 'deadbeef', usedAt: null }],
        created_at: '2026-06-19T00:00:00.000Z',
        activated_at: '2026-06-19T00:01:00.000Z',
        disabled_at: null,
      });
      expect(e.id).toBe('m1');
      expect(e.userId).toBe('user-9');
      expect(e.status).toBe('active');
      expect(e.secretEnc).toBe('enc:v1:zzz');
      expect(e.remainingRecoveryCodes).toBe(1);
    });
  });
});
