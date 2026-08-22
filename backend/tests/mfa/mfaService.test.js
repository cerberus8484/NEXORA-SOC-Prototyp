'use strict';

const { MfaService } = require('../../src/services/MfaService');
const { InMemoryMfaRepository } = require('../../src/repositories/InMemoryMfaRepository');
const { totpToken } = require('../../src/mfa/totp');
const { isEncrypted } = require('../../src/config/secretsCrypto');

describe('MfaService — Enrollment-Flow', () => {
  let repo;
  let service;

  beforeEach(() => {
    repo = new InMemoryMfaRepository();
    service = new MfaService(repo);
  });

  describe('beginEnrollment()', () => {
    test('legt pending-Enrollment an und liefert Secret + otpauth-URI', async () => {
      const res = await service.beginEnrollment('user-1');
      expect(res.secret).toMatch(/^[A-Z2-7]+$/);          // Base32
      expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(res.enrollment.status).toBe('pending');
    });

    test('speichert das Secret NUR verschlüsselt at-rest', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      const stored = await repo.findByUser('user-1');
      expect(isEncrypted(stored.secretEnc)).toBe(true);
      expect(stored.secretEnc).not.toContain(secret);
    });

    test('verweigert, wenn bereits aktiv', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      await service.activate('user-1', totpToken(secret));
      await expect(service.beginEnrollment('user-1')).rejects.toThrow(/aktiv/i);
    });
  });

  describe('activate()', () => {
    test('gültiger TOTP-Code aktiviert MFA und liefert Recovery-Codes', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      const result = await service.activate('user-1', totpToken(secret));
      expect(result.recoveryCodes.length).toBeGreaterThanOrEqual(8);
      const stored = await repo.findByUser('user-1');
      expect(stored.status).toBe('active');
    });

    test('falscher Code wirft und aktiviert NICHT', async () => {
      await service.beginEnrollment('user-1');
      await expect(service.activate('user-1', '000000')).rejects.toThrow(/code/i);
      const stored = await repo.findByUser('user-1');
      expect(stored.status).toBe('pending');
    });

    test('wirft ohne vorheriges beginEnrollment', async () => {
      await expect(service.activate('ghost', '123456')).rejects.toThrow(/kein|nicht/i);
    });
  });

  describe('verify() — 2. Faktor', () => {
    test('akzeptiert gültigen TOTP-Code bei aktiver MFA', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      await service.activate('user-1', totpToken(secret));
      expect(await service.verify('user-1', totpToken(secret))).toBe(true);
    });

    test('lehnt falschen Code ab', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      await service.activate('user-1', totpToken(secret));
      expect(await service.verify('user-1', '000000')).toBe(false);
    });

    test('akzeptiert Recovery-Code und verbraucht ihn (nur einmal)', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      const { recoveryCodes } = await service.activate('user-1', totpToken(secret));
      const code = recoveryCodes[0];
      expect(await service.verify('user-1', code)).toBe(true);
      expect(await service.verify('user-1', code)).toBe(false); // verbraucht
    });

    test('gibt false bei nicht aktiver MFA', async () => {
      expect(await service.verify('ghost', '123456')).toBe(false);
    });
  });

  describe('disable()', () => {
    test('deaktiviert aktive MFA', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      await service.activate('user-1', totpToken(secret));
      await service.disable('user-1');
      const stored = await repo.findByUser('user-1');
      expect(stored.status).toBe('disabled');
      expect(await service.verify('user-1', totpToken(secret))).toBe(false);
    });
  });

  describe('getStatus()', () => {
    test('none ohne Enrollment', async () => {
      expect((await service.getStatus('ghost')).status).toBe('none');
    });

    test('active nach Aktivierung, ohne Secret/Hashes auszugeben', async () => {
      const { secret } = await service.beginEnrollment('user-1');
      await service.activate('user-1', totpToken(secret));
      const status = await service.getStatus('user-1');
      expect(status.status).toBe('active');
      expect(JSON.stringify(status)).not.toContain('enc:v1:');
      expect(status.secretEnc).toBeUndefined();
    });
  });
});
