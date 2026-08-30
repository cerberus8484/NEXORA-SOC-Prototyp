'use strict';

// ManualHostRepository — Vertrag + InMemory-Implementierung.
// Muster wie die anderen Domänen-Repos (ExternalLinkRepository).

class ManualHostRepository {
  // eslint-disable-next-line no-unused-vars
  async findAll()        { this._ni('findAll'); }
  // eslint-disable-next-line no-unused-vars
  async findById(id)     { this._ni('findById'); }
  // eslint-disable-next-line no-unused-vars
  async save(host)       { this._ni('save'); }
  // eslint-disable-next-line no-unused-vars
  async delete(id)       { this._ni('delete'); }

  _ni(m) { throw new Error(`ManualHostRepository.${m}() nicht implementiert`); }
}

class InMemoryManualHostRepository extends ManualHostRepository {
  constructor() {
    super();
    this._store = new Map(); // id → host
  }

  async findAll() {
    return [...this._store.values()]
      .map((h) => ({ ...h }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async findById(id) {
    const h = this._store.get(id);
    return h ? { ...h } : null;
  }

  async save(host) {
    this._store.set(host.id, { ...host });
    return { ...host };
  }

  async delete(id) {
    return this._store.delete(id);
  }

  clear() { this._store.clear(); }
  size()  { return this._store.size; }
}

module.exports = { ManualHostRepository, InMemoryManualHostRepository };
