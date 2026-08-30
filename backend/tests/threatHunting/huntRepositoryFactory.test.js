'use strict';

const config = require('../../src/config');
const { createHuntRepository } = require('../../src/threatHunting/repositories/huntRepositoryFactory');
const { InMemoryHuntRepository } = require('../../src/threatHunting/repositories/InMemoryHuntRepository');
const { PostgresHuntRepository } = require('../../src/threatHunting/repositories/PostgresHuntRepository');

describe('huntRepositoryFactory', () => {
  const original = config.db.enabled;
  afterEach(() => { config.db.enabled = original; });

  it('liefert InMemory wenn DB deaktiviert', () => {
    config.db.enabled = false;
    expect(createHuntRepository()).toBeInstanceOf(InMemoryHuntRepository);
  });

  it('liefert Postgres wenn DB aktiviert', () => {
    config.db.enabled = true;
    expect(createHuntRepository()).toBeInstanceOf(PostgresHuntRepository);
  });

  it('Default (Test-Umgebung) ist InMemory', () => {
    expect(original).toBe(false);
  });
});
