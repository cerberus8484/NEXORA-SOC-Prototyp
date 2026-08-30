'use strict';

// TicketRepository — Interface-Definition
// Alle Implementierungen (Postgres, InMemory) müssen diese Methoden bereitstellen.
// JavaScript hat kein formales Interface — dies ist bewusste Dokumentation + Laufzeitschutz.

class TicketRepository {
  // eslint-disable-next-line no-unused-vars
  async save(ticket)                { this._notImplemented('save'); }
  // eslint-disable-next-line no-unused-vars
  async findById(id)                { this._notImplemented('findById'); }
  // eslint-disable-next-line no-unused-vars
  async findAll(filters)            { this._notImplemented('findAll'); }
  // Dedup: offenes Ticket mit (source, offenseId) finden — null wenn keins offen.
  // eslint-disable-next-line no-unused-vars
  async findByOffense(source, offenseId) { this._notImplemented('findByOffense'); }
  // Anti-Flood-Dedup: offenes Ticket mit (source, srcIp, dstIp, category) — null wenn keins.
  // eslint-disable-next-line no-unused-vars
  async findOpenByEndpoints(source, key) { this._notImplemented('findOpenByEndpoints'); }
  // eslint-disable-next-line no-unused-vars
  async findByIndicator(value, excludeId) { this._notImplemented('findByIndicator'); }
  // eslint-disable-next-line no-unused-vars
  async findByHost(opts)            { this._notImplemented('findByHost'); }
  // Child-Tickets eines Parent-Cases (für die Correlation Engine).
  // eslint-disable-next-line no-unused-vars
  async findChildren(parentId, opts) { this._notImplemented('findChildren'); }
  // eslint-disable-next-line no-unused-vars
  async delete(id)                  { this._notImplemented('delete'); }
  // Sammel-Löschung — gibt { deletedIds } der tatsächlich entfernten Tickets zurück.
  // eslint-disable-next-line no-unused-vars
  async deleteMany(ids)             { this._notImplemented('deleteMany'); }

  _notImplemented(method) {
    throw new Error(`TicketRepository.${method}() ist nicht implementiert`);
  }
}

module.exports = { TicketRepository };
