'use strict';

const { aggregateTickets, calcMttr, calcFpRate, countBy, topRules, analystLoad } = require('../../src/domain/socMetricsAggregate');

const BASE = '2026-06-01T08:00:00.000Z';
function t(o = {}) {
  return { state: 'OPEN', status: 'assigned', closeReason: '', analyst: '', offenseId: '', createdAt: BASE, updatedAt: BASE, closedAt: null, ...o };
}
function plus(ms) { return new Date(Date.parse(BASE) + ms).toISOString(); }

describe('socMetricsAggregate', () => {
  it('leer → neutrale KPIs', () => {
    const a = aggregateTickets([]);
    expect(a.mttr).toEqual({ meanMs: null, medianMs: null, sampleSize: 0 });
    expect(a.fpRate).toEqual({ rate: null, fpCount: 0, classifiedCount: 0 });
    expect(a.byState).toEqual({});
    expect(a.topRules).toEqual([]);
    expect(a.analystLoad).toEqual([]);
  });

  it('MTTR mean/median aus closedAt (nicht updatedAt) für CLOSED-Tickets', () => {
    const m = calcMttr([
      // updatedAt weit in der Zukunft → darf MTTR NICHT beeinflussen (Audit #1)
      t({ state: 'CLOSED', closedAt: plus(1000), updatedAt: plus(999999) }),
      t({ state: 'CLOSED', closedAt: plus(3000), updatedAt: plus(999999) }),
      t({ state: 'OPEN' }), // ignoriert
    ]);
    expect(m.sampleSize).toBe(2);
    expect(m.meanMs).toBe(2000);
    expect(m.medianMs).toBe(2000);
  });

  it('MTTR ignoriert CLOSED ohne closedAt', () => {
    const m = calcMttr([
      t({ state: 'CLOSED', closedAt: null, updatedAt: plus(5000) }), // kein closedAt → raus
      t({ state: 'CLOSED', closedAt: plus(4000) }),
    ]);
    expect(m.sampleSize).toBe(1);
    expect(m.meanMs).toBe(4000);
  });

  it('FP-Rate über KLASSIFIZIERT geschlossene Tickets (Nenner = close_reason<>"")', () => {
    // 1 FP, 1 resolved (beide klassifiziert), 1 CLOSED ohne Grund (zählt NICHT), 1 OPEN
    expect(calcFpRate([
      t({ state: 'CLOSED', closeReason: 'false_positive' }),
      t({ state: 'CLOSED', closeReason: 'resolved' }),
      t({ state: 'CLOSED', closeReason: '' }), // nicht klassifiziert → nicht im Nenner
      t({ state: 'OPEN' }),
    ])).toEqual({ rate: 0.5, fpCount: 1, classifiedCount: 2 });
  });

  it('FP-Rate null wenn kein klassifiziert geschlossenes Ticket', () => {
    expect(calcFpRate([
      t({ state: 'CLOSED', closeReason: '' }),
      t({ state: 'OPEN' }),
    ])).toEqual({ rate: null, fpCount: 0, classifiedCount: 0 });
  });

  it('Zeitraumfilter (since) grenzt auf createdAt >= since ein', () => {
    const a = aggregateTickets([
      t({ state: 'OPEN', createdAt: '2026-06-01T00:00:00.000Z' }), // vor since → raus
      t({ state: 'OPEN', createdAt: '2026-06-10T00:00:00.000Z' }), // nach since → drin
    ], { since: '2026-06-05T00:00:00.000Z' });
    expect(a.byState).toEqual({ OPEN: 1 });
  });

  it('ungültiges since → All-Time (kein Filter)', () => {
    const a = aggregateTickets([t({ state: 'OPEN' }), t({ state: 'CLOSED', closedAt: plus(1000) })], { since: 'not-a-date' });
    expect(a.byState).toEqual({ OPEN: 1, CLOSED: 1 });
  });

  it('countBy mit _unset für leere Werte', () => {
    expect(countBy([t({ state: 'OPEN' }), t({ state: '' })], 'state')).toEqual({ OPEN: 1, _unset: 1 });
  });

  it('topRules extrahiert den rule-Key', () => {
    const r = topRules([t({ offenseId: 'rule:100:agent:x' }), t({ offenseId: 'rule:100:agent:y' }), t({ offenseId: '12345' })], 10);
    expect(r).toContainEqual({ key: 'rule:100', count: 2 });
    expect(r).toContainEqual({ key: '12345', count: 1 });
  });

  it('analystLoad nur aggregierte Zählwerte + _unassigned', () => {
    const l = analystLoad([
      t({ analyst: 'alice', state: 'OPEN' }),
      t({ analyst: 'alice', state: 'CLOSED' }),
      t({ analyst: '', state: 'OPEN' }),
    ], 10);
    expect(l).toContainEqual({ analyst: 'alice', total: 2, open: 1 });
    expect(l).toContainEqual({ analyst: '_unassigned', total: 1, open: 1 });
  });
});
