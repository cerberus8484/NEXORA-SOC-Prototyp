'use strict';

// Factory- & Vertragstest für das ApiToken-Repo.
// Wichtig: require('../../src/repositories/PostgresApiTokenRepository') lädt das
// Modul wirklich (inkl. seiner top-level requires). Ein falscher DB-Import
// (z. B. '../db' statt '../db/pool') würde hier "Cannot find module" werfen —
// genau dieser Vertragstest fängt den sonst nur latent auftretenden Bug.

const { createApiTokenRepository }   = require('../../src/repositories/apiTokenRepositoryFactory');
const { InMemoryApiTokenRepository } = require('../../src/repositories/InMemoryApiTokenRepository');
const { PostgresApiTokenRepository } = require('../../src/repositories/PostgresApiTokenRepository');

describe('ApiToken-Repository — Factory & Vertrag', () => {
  test('Factory liefert ohne DB_ENABLED das InMemory-Repo', () => {
    expect(createApiTokenRepository()).toBeInstanceOf(InMemoryApiTokenRepository);
  });

  test('Postgres-Repo lässt sich ohne DB importieren und instanziieren', () => {
    expect(() => new PostgresApiTokenRepository()).not.toThrow();
  });

  test('Postgres- und InMemory-Repo haben denselben öffentlichen Vertrag', () => {
    const methods = ['save', 'findById', 'findByHash', 'listByUser', 'revoke', 'updateLastUsed'];
    for (const m of methods) {
      expect(typeof InMemoryApiTokenRepository.prototype[m]).toBe('function');
      expect(typeof PostgresApiTokenRepository.prototype[m]).toBe('function');
    }
  });
});
