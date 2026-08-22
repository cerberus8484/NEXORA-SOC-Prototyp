'use strict';

const { createMfaRepository }   = require('../../src/repositories/mfaRepositoryFactory');
const { InMemoryMfaRepository } = require('../../src/repositories/InMemoryMfaRepository');
const { PostgresMfaRepository } = require('../../src/repositories/PostgresMfaRepository');
const { MfaEnrollment }         = require('../../src/domain/MfaEnrollment');

describe('MFA-Repository — Factory & Vertrag', () => {
  test('Factory liefert ohne DB_ENABLED das InMemory-Repo', () => {
    expect(createMfaRepository()).toBeInstanceOf(InMemoryMfaRepository);
  });

  test('Postgres- und InMemory-Repo haben denselben öffentlichen Vertrag', () => {
    const methods = ['save', 'findByUser', 'deleteByUser'];
    for (const m of methods) {
      expect(typeof InMemoryMfaRepository.prototype[m]).toBe('function');
      expect(typeof PostgresMfaRepository.prototype[m]).toBe('function');
    }
  });

  test('InMemory-Repo speichert und findet je User (eine Anmeldung pro User)', async () => {
    const repo = new InMemoryMfaRepository();
    const e = MfaEnrollment.create({ userId: 'u1', secretEnc: 'enc:v1:x' });
    await repo.save(e);
    expect(await repo.findByUser('u1')).toBe(e);
    await repo.deleteByUser('u1');
    expect(await repo.findByUser('u1')).toBeNull();
  });

  test('erneutes save() überschreibt dieselbe User-Anmeldung (kein Duplikat)', async () => {
    const repo = new InMemoryMfaRepository();
    await repo.save(MfaEnrollment.create({ userId: 'u1', secretEnc: 'enc:v1:a' }));
    await repo.save(MfaEnrollment.create({ userId: 'u1', secretEnc: 'enc:v1:b' }));
    expect(repo.size()).toBe(1);
  });
});
