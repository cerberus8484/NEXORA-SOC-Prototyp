'use strict';

const { instrumentJob } = require('../../src/metrics/instrumentJob');

function fakeMetrics() {
  return {
    inFlight:    { v: 0, inc() { this.v++; }, dec() { this.v--; } },
    processed:   { calls: [], inc(l) { this.calls.push(l.result); } },
    lastSuccess: { v: null, set(x) { this.v = x; } },
  };
}

describe('instrumentJob', () => {
  it('Erfolg: processed=completed, lastSuccess gesetzt, in_flight ausgeglichen', async () => {
    const m = fakeMetrics();
    const wrapped = instrumentJob(async () => 'ok', { ...m, now: () => 1234 });
    const r = await wrapped({ id: 'j1' });
    expect(r).toBe('ok');
    expect(m.processed.calls).toEqual(['completed']);
    expect(m.lastSuccess.v).toBe(1234);
    expect(m.inFlight.v).toBe(0);
  });

  it('Fehler: processed=failed, Fehler weitergeworfen, kein lastSuccess, in_flight ausgeglichen', async () => {
    const m = fakeMetrics();
    const wrapped = instrumentJob(async () => { throw new Error('boom'); }, { ...m });
    await expect(wrapped({ id: 'j2' })).rejects.toThrow('boom');
    expect(m.processed.calls).toEqual(['failed']);
    expect(m.lastSuccess.v).toBeNull();
    expect(m.inFlight.v).toBe(0);
  });

  it('in_flight ist WÄHREND der Verarbeitung erhöht', async () => {
    const m = fakeMetrics();
    let during = -1;
    const wrapped = instrumentJob(async () => { during = m.inFlight.v; }, { ...m });
    await wrapped({});
    expect(during).toBe(1);
    expect(m.inFlight.v).toBe(0);
  });
});
