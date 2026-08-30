'use strict';

const { createEventLoopLagMonitor } = require('../../src/metrics/eventLoopLag');

describe('createEventLoopLagMonitor', () => {
  it('misst Lag als Überschreitung der erwarteten Resolution', () => {
    let captured;
    const schedule = (fn) => { captured = fn; return () => {}; };
    let t = 0;
    const m = createEventLoopLagMonitor({ resolutionMs: 1000, hrtimeMs: () => t, schedule });

    m.start();          // prev = 0
    t = 1000; captured(); // pünktlich → Lag 0
    expect(m.getLagSeconds()).toBe(0);

    t = 2200; captured(); // 1200ms statt 1000 → 200ms Lag
    expect(m.getLagSeconds()).toBeCloseTo(0.2, 5);
  });

  it('Lag wird nie negativ (Timer früher als erwartet)', () => {
    let captured;
    const schedule = (fn) => { captured = fn; return () => {}; };
    let t = 0;
    const m = createEventLoopLagMonitor({ resolutionMs: 1000, hrtimeMs: () => t, schedule });
    m.start();
    t = 1500; captured(); // prev=0 → 500ms Lag, dann prev=1500
    t = 1800; captured(); // (1800-1500)-1000 = -700 → 0
    expect(m.getLagSeconds()).toBe(0);
  });

  it('start ist idempotent (kein doppelter Timer)', () => {
    let calls = 0;
    const m = createEventLoopLagMonitor({ schedule: () => { calls++; return () => {}; } });
    m.start();
    m.start();
    expect(calls).toBe(1);
  });

  it('getLagSeconds ist 0 vor dem Start', () => {
    const m = createEventLoopLagMonitor({ schedule: () => () => {} });
    expect(m.getLagSeconds()).toBe(0);
  });

  it('close stoppt den Timer', () => {
    let stopped = false;
    const m = createEventLoopLagMonitor({ schedule: () => () => { stopped = true; } });
    m.start();
    m.close();
    expect(stopped).toBe(true);
  });
});
