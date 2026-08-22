'use strict';

const config = require('../../src/config');

const { createTicketRepository } = require('../../src/repositories/ticketRepositoryFactory');
const { createUserRepository }   = require('../../src/repositories/userRepositoryFactory');
const { createAuditRepository }  = require('../../src/repositories/auditRepositoryFactory');

const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');
const { PostgresTicketRepository } = require('../../src/repositories/PostgresTicketRepository');
const { InMemoryUserRepository }   = require('../../src/repositories/InMemoryUserRepository');
const { PostgresUserRepository }   = require('../../src/repositories/PostgresUserRepository');
const { PostgresAuditRepository }  = require('../../src/repositories/PostgresAuditRepository');

describe('Repository-Factories (config.db.enabled)', () => {
  const original = config.db.enabled;
  afterEach(() => { config.db.enabled = original; });

  it('Default (Tests) ist DB deaktiviert', () => {
    expect(original).toBe(false);
  });

  describe('deaktiviert → InMemory / null', () => {
    beforeEach(() => { config.db.enabled = false; });
    it('Ticket → InMemory', () => expect(createTicketRepository()).toBeInstanceOf(InMemoryTicketRepository));
    it('User → InMemory',   () => expect(createUserRepository()).toBeInstanceOf(InMemoryUserRepository));
    it('Audit → null (interner _log)', () => expect(createAuditRepository()).toBeNull());
  });

  describe('aktiviert → Postgres', () => {
    beforeEach(() => { config.db.enabled = true; });
    it('Ticket → Postgres', () => expect(createTicketRepository()).toBeInstanceOf(PostgresTicketRepository));
    it('User → Postgres',   () => expect(createUserRepository()).toBeInstanceOf(PostgresUserRepository));
    it('Audit → Postgres',  () => expect(createAuditRepository()).toBeInstanceOf(PostgresAuditRepository));
  });
});
