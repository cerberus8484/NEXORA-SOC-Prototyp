'use strict';

const { Ticket }                  = require('../domain/Ticket');
const { NotFoundError }           = require('../errors/AppError');
const { InMemoryTicketRepository } = require('../repositories/InMemoryTicketRepository');
const { metrics }                 = require('../metrics/metricsRegistry');

class TicketService {
  constructor(repository = null) {
    // P5: Repository wird injiziert — kein direkter DB-Zugriff im Service
    // Default: InMemory für direkte Instanziierung in Tests
    this._repo = repository || new InMemoryTicketRepository();
  }

  async create(data) {
    // Fortlaufende Ticket-Nummer im Format INC000001 (falls nicht vorgegeben).
    const ticketNr = data.ticketNr || await this._nextTicketNr();
    const ticket = Ticket.create({ ...data, ticketNr });
    const saved = await this._repo.save(ticket);
    // P20: Prometheus-Counter
    // Hinweis: Endpoint-Evidence-Sammlung (Wazuh) ist ein Route-Side-Effect und
    // liegt in routes/tickets.js — nicht im Domain-Service (vermeidet Zirkularität).
    metrics.ticketsTotal.inc({ severity: saved.priority || 'unknown' });
    return saved;
  }

  async _nextTicketNr() {
    if (typeof this._repo.nextTicketNumber === 'function') {
      const n = await this._repo.nextTicketNumber();
      return `INC${String(n).padStart(6, '0')}`;
    }
    return '';
  }

  async findAll(filters = {}) {
    return await this._repo.findAll(filters);
  }

  // Nur die IDs der gefilterten Tickets („alle gefilterten auswählen"). Nutzt EXAKT dieselbe
  // Filterung wie findAll (keine Divergenz) und gibt bewusst nur { ids, total } zurück — die
  // Liste selbst ist auf limit≤500 gedeckelt, dieser Pfad erlaubt bis 5000 (via idTicketsSchema).
  async findIds(filters = {}) {
    const { data, total } = await this._repo.findAll(filters);
    return { ids: (data || []).map((t) => t.id), total };
  }

  async findById(id) {
    const ticket = await this._repo.findById(id);
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }

  // Cross-Reference: andere Tickets, die denselben Indikator (IP/Domain/Datei/Hash) referenzieren.
  async findByIndicator(value, excludeId = null) {
    const v = String(value || '').trim();
    if (!v) return [];
    return this._repo.findByIndicator(v, excludeId);
  }

  // Alert-Historie eines Hosts: Tickets, deren agentId (im offenseId :agent:<id>)
  // oder hostname übereinstimmt. Delegiert an das Repository (Postgres: ILIKE-Query,
  // InMemory: gefilterter Array-Scan) — kein limit:1000-Workaround mehr.
  async findByHost({ agentId = '', hostname = '', limit = 20 } = {}) {
    const aid = String(agentId || '').trim();
    const hn  = String(hostname || '').trim();
    if (!aid && !hn) return [];
    const max = Math.max(1, Math.min(Number(limit) || 20, 100));
    return this._repo.findByHost({ agentId: aid, hostname: hn, limit: max });
  }

  // Dedup für Integrationen: offenes Ticket zu (source, offenseId) oder null.
  async findOpenByOffense(source, offenseId) {
    return await this._repo.findByOffense(source, offenseId);
  }

  // Anti-Flood-Dedup: offenes Ticket desselben (source, srcIp, dstIp, category) oder null.
  // Für wiederkehrendes Rauschen, dessen externe ID pro Zeitfenster churnt.
  async findOpenByEndpoints(source, { srcIp, dstIp, category } = {}) {
    return await this._repo.findOpenByEndpoints(source, { srcIp, dstIp, category });
  }

  // Vorhandene Child-Offenses eines Hosts unter einen Parent-Case hängen.
  async assignParentByAgent(agentId, parentId) {
    return await this._repo.assignParentByAgent(agentId, parentId);
  }

  // Child-Tickets eines Parent-Cases (für die Correlation Engine).
  async findChildren(parentId, { limit = 200 } = {}) {
    if (!parentId) return [];
    const max = Math.max(1, Math.min(Number(limit) || 200, 500));
    return this._repo.findChildren(parentId, { limit: max });
  }

  async update(id, data) {
    const existing = await this.findById(id); // wirft NotFoundError
    const ticket   = new Ticket(existing);
    const updated  = ticket.update(data);
    return await this._repo.save(updated);
  }

  async delete(id) {
    await this.findById(id); // wirft NotFoundError wenn nicht vorhanden
    await this._repo.delete(id);
  }

  // Sammel-Löschung: dedupliziert, delegiert an EINE atomare Repo-Operation.
  // Ergebnis ist nachvollziehbar (requested/deleted/missing/deletedIds) und ehrlich —
  // kein Fehler, wenn einzelne IDs nicht (mehr) existieren (idempotent). Die Obergrenze
  // erzwingt das Route-Schema (kein unbounded Delete).
  async deleteMany(ids = []) {
    const unique = [...new Set((ids || []).map((v) => String(v)))];
    if (!unique.length) return { requested: 0, deleted: 0, missing: 0, deletedIds: [] };
    const { deletedIds } = await this._repo.deleteMany(unique);
    return {
      requested: unique.length,
      deleted:   deletedIds.length,
      missing:   unique.length - deletedIds.length,
      deletedIds,
    };
  }
}

// Default-Singleton: Repository via Factory (Postgres bei DB_ENABLED, sonst InMemory)
const { createTicketRepository } = require('../repositories/ticketRepositoryFactory');
const ticketService = new TicketService(createTicketRepository());

module.exports = { TicketService, ticketService };
