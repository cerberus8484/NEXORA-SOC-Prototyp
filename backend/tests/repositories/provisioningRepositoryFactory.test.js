'use strict';

// P_PROVISION_2 — Factory wählt InMemory/Postgres je nach config.db.enabled.
const config = require('../../src/config');
const { createProvisioningRepository } = require('../../src/repositories/provisioningRepositoryFactory');
const { InMemoryProvisioningRepository } = require('../../src/repositories/InMemoryProvisioningRepository');
const { PostgresProvisioningRepository } = require('../../src/repositories/PostgresProvisioningRepository');

describe('provisioningRepositoryFactory (config.db.enabled)', () => {
  const original = config.db.enabled;
  afterEach(() => { config.db.enabled = original; });

  it('deaktiviert → InMemory', () => {
    config.db.enabled = false;
    expect(createProvisioningRepository()).toBeInstanceOf(InMemoryProvisioningRepository);
  });

  it('aktiviert → Postgres', () => {
    config.db.enabled = true;
    expect(createProvisioningRepository()).toBeInstanceOf(PostgresProvisioningRepository);
  });
});
