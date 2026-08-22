'use strict';

// Kollektoren-/Quellen-Aktivität (P1 #6-Folge): echte Ingestion je source aus Tickets.
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');

const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const tk = (id, source, createdAt) => ({ id, source, createdAt, state: 'OPEN', status: 'NEW' });

describe('InMemoryTicketRepository.ingestActivityBySource', () => {
  let repo;
  beforeEach(async () => {
    repo = new InMemoryTicketRepository();
    await repo.save(tk('1', 'dataplane', hoursAgo(1)));
    await repo.save(tk('2', 'dataplane', hoursAgo(48)));
    await repo.save(tk('3', 'wazuh', hoursAgo(2)));
    await repo.save(tk('4', '', hoursAgo(3))); // leere source → 'unknown'
  });

  it('gruppiert je Quelle mit total, recent(24h) und lastSeen', async () => {
    const rows = await repo.ingestActivityBySource({ windowHours: 24 });
    const dp = rows.find((r) => r.source === 'dataplane');
    expect(dp.total).toBe(2);
    expect(dp.recent).toBe(1); // nur das 1h-alte Ticket fällt in die 24h
    expect(new Date(dp.lastSeen).getTime()).toBeGreaterThan(0);
  });

  it('sortiert nach total absteigend', async () => {
    const rows = await repo.ingestActivityBySource();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total).toBeGreaterThanOrEqual(rows[i].total);
    }
  });

  it('mappt leere/fehlende source auf "unknown"', async () => {
    const rows = await repo.ingestActivityBySource();
    expect(rows.some((r) => r.source === 'unknown')).toBe(true);
  });

  it('liefert eine leere Liste, wenn keine Tickets existieren', async () => {
    const empty = new InMemoryTicketRepository();
    expect(await empty.ingestActivityBySource()).toEqual([]);
  });
});
