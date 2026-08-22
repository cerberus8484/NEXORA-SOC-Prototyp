'use strict';

const { TicketRepository } = require('./TicketRepository');
const { aggregateTickets } = require('../domain/socMetricsAggregate');

// InMemoryTicketRepository — für Tests und lokale Entwicklung ohne DB
// Bleibt dauerhaft erhalten: nützlich für schnelle Unit-Tests

class InMemoryTicketRepository extends TicketRepository {
  constructor() {
    super();
    this._store = new Map();
    this._seq = 0;
  }

  async nextTicketNumber() {
    this._seq += 1;
    return this._seq;
  }

  async save(ticket) {
    this._store.set(ticket.id, { ...ticket });
    return { ...ticket };
  }

  async findById(id) {
    const ticket = this._store.get(id);
    return ticket ? { ...ticket } : null;
  }

  // Ingestion-Aktivität je Quelle (echte Ticket-Daten): total, letzte `windowHours`,
  // und last-seen. Beantwortet "kommt von Quelle/Kollektor X echt was an?".
  async ingestActivityBySource({ windowHours = 24 } = {}) {
    const cutoff = Date.now() - Math.max(1, Number(windowHours) || 24) * 3600 * 1000;
    const bySource = new Map();
    for (const t of this._store.values()) {
      const source = t.source && String(t.source).trim() ? t.source : 'unknown';
      const created = new Date(t.createdAt).getTime();
      const e = bySource.get(source) || { source, total: 0, recent: 0, lastSeen: null };
      e.total += 1;
      if (!Number.isNaN(created)) {
        if (created >= cutoff) e.recent += 1;
        if (!e.lastSeen || created > new Date(e.lastSeen).getTime()) e.lastSeen = t.createdAt;
      }
      bySource.set(source, e);
    }
    return [...bySource.values()].sort((a, b) => b.total - a.total);
  }

  async findAll({ state, status, priority, source, analyst, customer, search, limit = 50, offset = 0, sort = 'createdAt', order = 'desc' } = {}) {
    let tickets = Array.from(this._store.values());

    if (state)    tickets = tickets.filter(t => t.state    === state);
    if (status)   tickets = tickets.filter(t => t.status   === status);
    if (priority) tickets = tickets.filter(t => t.priority === priority);
    if (source)   tickets = tickets.filter(t => t.source   === source);
    if (customer) tickets = tickets.filter(t => t.customer === customer);
    if (analyst)  tickets = tickets.filter(t => t.analyst  === analyst);
    if (search) {
      const q = search.toLowerCase();
      tickets = tickets.filter(t =>
        [t.title, t.ticketNr, t.offenseId, t.category, t.srcIp, t.hostname, t.user]
          .some(v => v && v.toLowerCase().includes(q))
      );
    }

    tickets.sort((a, b) => {
      const av = a[sort] || '';
      const bv = b[sort] || '';
      return order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return {
      data:   tickets.slice(offset, offset + limit).map(t => ({ ...t })),
      total:  tickets.length,
      limit,
      offset,
    };
  }

  async findByOffense(source, offenseId) {
    if (!source || !offenseId) return null;
    const match = Array.from(this._store.values())
      .filter(t => t.source === source && t.offenseId === offenseId && (t.state ?? 'OPEN') === 'OPEN')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return match.length ? { ...match[0] } : null;
  }

  // Anti-Flood-Dedup: offenes Ticket desselben (source, srcIp, dstIp, category).
  // Für wiederkehrendes observed-Rauschen, dessen incidentId pro Fenster churnt.
  async findOpenByEndpoints(source, { srcIp, dstIp, category } = {}) {
    if (!source || !srcIp || !dstIp || !category) return null;
    const match = Array.from(this._store.values())
      .filter(t => t.source === source && t.srcIp === srcIp && t.dstIp === dstIp
        && t.category === category && (t.state ?? 'OPEN') === 'OPEN')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return match.length ? { ...match[0] } : null;
  }

  async assignParentByAgent(agentId, parentId) {
    if (!agentId || !parentId) return 0;
    let n = 0;
    for (const t of this._store.values()) {
      if (t.source === 'wazuh' && (t.kind || 'alert') === 'alert' && !t.parentId
          && String(t.offenseId || '').includes(`:agent:${agentId}`)) {
        t.parentId = parentId; n++;
      }
    }
    return n;
  }

  // Cross-Reference: Tickets die denselben Indikator referenzieren (Array-Scan).
  async findByIndicator(value, excludeId = null) {
    const v = String(value || '').toLowerCase();
    if (!v) return [];
    return Array.from(this._store.values())
      .filter((t) => t.id !== excludeId)
      .filter((t) => [t.srcIp, t.dstIp, t.srcFqdn, t.dstFqdn, t.iocs]
        .some((f) => String(f || '').toLowerCase().includes(v)))
      .map((t) => ({ id: t.id, ticketNr: t.ticketNr, title: t.title, priority: t.priority, state: t.state, status: t.status, createdAt: t.createdAt }));
  }

  // Alert-Historie eines Hosts (agentId via offenseId :agent:<id> oder hostname).
  async findByHost({ agentId = '', hostname = '', limit = 20 } = {}) {
    const aid = String(agentId || '').trim();
    const hn  = String(hostname || '').trim().toLowerCase();
    if (!aid && !hn) return [];
    const matches = Array.from(this._store.values()).filter((t) => {
      const byAgent = aid && String(t.offenseId || '').includes(`:agent:${aid}`);
      const byHost  = hn && String(t.hostname || '').trim().toLowerCase() === hn;
      return Boolean(byAgent || byHost);
    });
    matches.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return matches.slice(0, limit).map((t) => ({
      id: t.id, ticketNr: t.ticketNr, title: t.title, priority: t.priority,
      state: t.state, status: t.status, mitre: t.mitre, offenseId: t.offenseId,
      description: t.description, createdAt: t.createdAt,
    }));
  }

  // Child-Tickets eines Parent-Cases — neueste zuerst, begrenzt.
  async findChildren(parentId, { limit = 200 } = {}) {
    if (!parentId) return [];
    return Array.from(this._store.values())
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async delete(id) {
    this._store.delete(id);
  }

  // Sammel-Löschung — Map.delete liefert true nur wenn der Eintrag existierte,
  // daraus die tatsächlich entfernten IDs (für ein ehrliches Ergebnis).
  async deleteMany(ids = []) {
    const deletedIds = [];
    for (const id of ids) {
      if (this._store.delete(id)) deletedIds.push(id);
    }
    return { deletedIds };
  }

  // P_STABILITY_2 3.3: SOC-Metriken aggregieren. InMemory lädt bounded über findAll
  // (gleiche Sortierung wie der Service-Fallback) und aggregiert rein — Dev/Test-Pfad.
  async aggregateMetrics({ topN = 10, since = null } = {}) {
    const { data, total } = await this.findAll({ limit: 5000, offset: 0 });
    return {
      ...aggregateTickets(data, { topN, since }),
      meta: { totalTickets: total, sampledTickets: data.length, capped: total > data.length, since: since || null },
    };
  }

  // Test-Hilfsmethode
  clear() { this._store.clear(); }
  size()  { return this._store.size; }
}

module.exports = { InMemoryTicketRepository };
