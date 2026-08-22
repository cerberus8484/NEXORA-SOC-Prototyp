'use strict';

class IntegrationRepository {
  // eslint-disable-next-line no-unused-vars
  async save(event)                  { this._ni('save'); }
  // eslint-disable-next-line no-unused-vars
  async findByDeduplicationKey(key)  { this._ni('findByDeduplicationKey'); }
  // eslint-disable-next-line no-unused-vars
  async findAll(filters)             { this._ni('findAll'); }

  _ni(m) { throw new Error(`IntegrationRepository.${m}() nicht implementiert`); }
}

class InMemoryIntegrationRepository extends IntegrationRepository {
  constructor() {
    super();
    this._store = new Map();      // id → event
    this._dedupIndex = new Map(); // deduplicationKey → id
  }

  async save(event) {
    this._store.set(event.id, { ...event });
    this._dedupIndex.set(event.deduplicationKey, event.id);
    return { ...event };
  }

  async findByDeduplicationKey(key) {
    const id = this._dedupIndex.get(key);
    return id ? { ...this._store.get(id) } : null;
  }

  async findAll() {
    return Array.from(this._store.values()).map(e => ({ ...e }));
  }

  clear() { this._store.clear(); this._dedupIndex.clear(); }
  size()  { return this._store.size; }
}

module.exports = { IntegrationRepository, InMemoryIntegrationRepository };
