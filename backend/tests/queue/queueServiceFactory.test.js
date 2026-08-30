'use strict';

// P_CORR_1b · Pflichtregel 8 — bei DB_ENABLED=true KEIN stiller Fallback auf InMemory.
// PgBoss wird gemockt (das echte ESM-pg-boss lädt Jest nicht); config bleibt echt (Logger
// braucht config.log) und wird nur am Singleton umgeschaltet.

jest.mock('../../src/queue/PgBossQueueService', () => ({
  PgBossQueueService: class FakePgBoss { constructor() { this.kind = 'pgboss'; } },
}));

const config = require('../../src/config');
const { createQueueService } = require('../../src/queue/queueServiceFactory');
const { InMemoryQueueService } = require('../../src/queue/InMemoryQueueService');
const { PgBossQueueService } = require('../../src/queue/PgBossQueueService'); // = Fake

const originalDbEnabled = config.db.enabled;
afterEach(() => { config.db.enabled = originalDbEnabled; });

describe('queueServiceFactory', () => {
  test('DB_ENABLED=false → InMemory-Queue (Dev/Test-Fallback)', () => {
    config.db.enabled = false;
    expect(createQueueService()).toBeInstanceOf(InMemoryQueueService);
  });

  test('DB_ENABLED=true → persistente pg-boss-Queue, NIEMALS InMemory', () => {
    config.db.enabled = true;
    const q = createQueueService();
    expect(q).toBeInstanceOf(PgBossQueueService);
    expect(q).not.toBeInstanceOf(InMemoryQueueService); // kein stiller Fallback
  });
});
