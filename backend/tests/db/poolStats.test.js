'use strict';

// P_STABILITY_1 · Task 3a — Pool-Sättigung muss sichtbar werden (strukturiertes Log),
// bevor die nächste Query blockiert. Reine Helfer → ohne DB testbar.

const { poolSnapshot, isSaturated, logPoolSaturation } = require('../../src/db/poolStats');

function fakePool({ total = 0, idle = 0, waiting = 0, max = 10 } = {}) {
  return { totalCount: total, idleCount: idle, waitingCount: waiting, options: { max } };
}

describe('poolSnapshot', () => {
  it('liest die Zähler aus dem Pool', () => {
    expect(poolSnapshot(fakePool({ total: 5, idle: 2, waiting: 1, max: 10 })))
      .toEqual({ total: 5, idle: 2, waiting: 1, max: 10 });
  });
});

describe('isSaturated', () => {
  it('wartende Anforderer → gesättigt', () => {
    expect(isSaturated({ total: 10, idle: 0, waiting: 3, max: 10 })).toBe(true);
  });
  it('alle Verbindungen belegt, kein idle, am Maximum → gesättigt', () => {
    expect(isSaturated({ total: 10, idle: 0, waiting: 0, max: 10 })).toBe(true);
  });
  it('freie Verbindungen → nicht gesättigt', () => {
    expect(isSaturated({ total: 5, idle: 3, waiting: 0, max: 10 })).toBe(false);
  });
  it('leere Eingabe → nicht gesättigt (defensiv)', () => {
    expect(isSaturated(null)).toBe(false);
  });
});

describe('logPoolSaturation', () => {
  it('loggt strukturierte Warnung bei Sättigung — nur Zähler, keine Secrets', () => {
    const warn = jest.fn();
    const did = logPoolSaturation(fakePool({ total: 10, idle: 0, waiting: 2, max: 10 }), { warn });
    expect(did).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const [event, payload] = warn.mock.calls[0];
    expect(event).toBe('pg_pool_saturated');
    expect(payload).toEqual({ total: 10, idle: 0, waiting: 2, max: 10 });
  });

  it('loggt nicht, wenn nicht gesättigt', () => {
    const warn = jest.fn();
    const did = logPoolSaturation(fakePool({ total: 3, idle: 2, waiting: 0, max: 10 }), { warn });
    expect(did).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
