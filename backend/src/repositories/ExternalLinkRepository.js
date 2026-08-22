'use strict';

class ExternalLinkRepository {
  // eslint-disable-next-line no-unused-vars
  async save(link)                        { this._ni('save'); }
  // eslint-disable-next-line no-unused-vars
  async findByDeduplicationKey(key)       { this._ni('findByDeduplicationKey'); }
  // eslint-disable-next-line no-unused-vars
  async findByTicketId(ticketId)          { this._ni('findByTicketId'); }

  _ni(m) { throw new Error(`ExternalLinkRepository.${m}() nicht implementiert`); }
}

class InMemoryExternalLinkRepository extends ExternalLinkRepository {
  constructor() {
    super();
    this._store     = new Map(); // id → link
    this._dedupIdx  = new Map(); // deduplicationKey → id
    this._ticketIdx = new Map(); // ticketId → Set<id>
  }

  async save(link) {
    this._store.set(link.id, { ...link });
    this._dedupIdx.set(link.deduplicationKey, link.id);
    if (!this._ticketIdx.has(link.internalTicketId)) {
      this._ticketIdx.set(link.internalTicketId, new Set());
    }
    this._ticketIdx.get(link.internalTicketId).add(link.id);
    return { ...link };
  }

  async findByDeduplicationKey(key) {
    const id = this._dedupIdx.get(key);
    return id ? { ...this._store.get(id) } : null;
  }

  async findByTicketId(ticketId) {
    const ids = this._ticketIdx.get(ticketId) || new Set();
    return [...ids].map(id => ({ ...this._store.get(id) }));
  }

  clear() { this._store.clear(); this._dedupIdx.clear(); this._ticketIdx.clear(); }
  size()  { return this._store.size; }
}

module.exports = { ExternalLinkRepository, InMemoryExternalLinkRepository };
