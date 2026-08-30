'use strict';

// InMemory-Intake-Repo (Dev/Test). Idempotenz-Schlüssel = collectorId:eventId.
// Postgres-Variante (Migrationen 005 intake_events / 007 outbox) ist Folge-Slice;
// die Business-Logik (intakeService) kennt nur dieses Interface.
function createInMemoryIntakeRepo() {
  const byKey = new Map();
  return {
    async has(key) { return byKey.has(key); },
    async save(key, record) { byKey.set(key, record); return record; },
    async get(key) { return byKey.get(key) || null; },
    count() { return byKey.size; },
    clear() { byKey.clear(); },
  };
}

module.exports = { createInMemoryIntakeRepo };
