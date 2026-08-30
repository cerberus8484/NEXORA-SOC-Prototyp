'use strict';

const { SocMetricsService } = require('../../src/services/SocMetricsService');

describe('SocMetricsService — Delegation (P_STABILITY_2 3.3)', () => {
  it('nutzt repo.aggregateMetrics, wenn vorhanden (SQL-Pfad, KEIN Vollscan in Node)', async () => {
    const sentinel = { mttr: {}, fpRate: {}, byState: {}, byStatus: {}, topRules: [], analystLoad: [], meta: { totalTickets: 7, sampledTickets: 7, capped: false } };
    const repo = { aggregateMetrics: jest.fn().mockResolvedValue(sentinel), findAll: jest.fn() };
    const svc = new SocMetricsService({ ticketRepo: repo, topN: 5 });

    const res = await svc.getMetrics();

    expect(repo.aggregateMetrics).toHaveBeenCalledWith({ topN: 5, since: null });
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(res).toBe(sentinel);
  });

  it('Fallback (Repo ohne aggregateMetrics): bounded load-all + reine Aggregation', async () => {
    const findAll = jest.fn().mockResolvedValue({ data: [{ state: 'OPEN', status: 'assigned' }], total: 1 });
    const svc = new SocMetricsService({ ticketRepo: { findAll } });

    const res = await svc.getMetrics();

    expect(findAll).toHaveBeenCalled();
    expect(res.byState).toEqual({ OPEN: 1 });
    expect(res.meta).toEqual({ totalTickets: 1, sampledTickets: 1, capped: false, since: null });
  });
});
