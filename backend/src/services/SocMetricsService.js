'use strict';

const { aggregateTickets } = require('../domain/socMetricsAggregate');

/**
 * SocMetricsService — SOC-Analyse-KPIs aus Ticket-Daten.
 *
 * KPIs: MTTR (mean/median), FP-Rate, Counts nach state/status, Top-N Rules,
 * Last pro Analyst. DSGVO (Art. 25 / 5(1c)): nur aggregierte Zählwerte, kein PII-Dump.
 *
 * P_STABILITY_2 · 3.3 — Aggregation läuft NICHT mehr zwingend in Node:
 *   - Repo mit aggregateMetrics() (Postgres) → Aggregation in SQL, KEIN großer Node-Load.
 *   - Sonst Fallback: bounded load-all (max 5 000) + reine Aggregation (Dev/Test, InMemory).
 * Die reine Aggregationslogik liegt in domain/socMetricsAggregate (voll getestet).
 */
class SocMetricsService {
  constructor({ ticketRepo, topN = 10 } = {}) {
    if (!ticketRepo) throw new Error('SocMetricsService: ticketRepo ist erforderlich');
    this._repo = ticketRepo;
    this._topN = Math.max(1, Number(topN) || 10);
  }

  /**
   * @param {{ since?: string|null }} [opts] — optionaler ISO-Zeitraumfilter (Audit #2);
   *   nur Tickets mit createdAt >= since. Die Route validiert `since` vorab.
   */
  async getMetrics({ since = null } = {}) {
    // Prod-Pfad: das Repository aggregiert serverseitig (SQL) → kein Ticket-Vollscan in Node.
    if (typeof this._repo.aggregateMetrics === 'function') {
      return this._repo.aggregateMetrics({ topN: this._topN, since });
    }

    // Fallback (Repos ohne Aggregation): bounded laden + rein aggregieren.
    const { tickets, total, capped } = await this._loadAll();
    return {
      ...aggregateTickets(tickets, { topN: this._topN, since }),
      // capped=true → KPIs beruhen nur auf einer Stichprobe; der Aufrufer MUSS das im UI
      // kenntlich machen (keine stillen Datenverluste).
      meta: { totalTickets: total, sampledTickets: tickets.length, capped, since: since || null },
    };
  }

  /**
   * Lädt alle Tickets über das Repository (paginiert, max. 5 000). Schützt vor einem
   * unkontrollierten Vollscan; nur der Fallback-Pfad (ohne Repo-Aggregation) nutzt das.
   */
  async _loadAll() {
    const PAGE = 500;
    const MAX  = 5000;
    const all  = [];
    let offset = 0;
    let total  = 0;

    while (offset < MAX) {
      const res = await this._repo.findAll({ limit: PAGE, offset });
      total = Number.isFinite(res.total) ? res.total : all.length + res.data.length;
      all.push(...res.data);
      if (all.length >= total || res.data.length < PAGE) break;
      offset += PAGE;
    }

    return { tickets: all, total, capped: all.length < total };
  }
}

module.exports = { SocMetricsService };
