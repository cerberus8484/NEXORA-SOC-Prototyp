'use strict';

const { createGracefulShutdown } = require('../../src/lifecycle/gracefulShutdown');

const silentLogger = { info: () => {}, error: () => {} };
// Force-Timer feuert in den Normal-Tests NICHT (nur manuell im Timeout-Test).
const noopTimer = { setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {} };

describe('createGracefulShutdown', () => {
  it('schließt alle Closer in Reihenfolge und beendet mit Code 0', async () => {
    const order = [];
    const exit = jest.fn();
    const closers = [
      { name: 'server', close: async () => { order.push('server'); } },
      { name: 'pool',   close: async () => { order.push('pool'); } },
    ];
    const { shutdown } = createGracefulShutdown({ closers, logger: silentLogger, exit, ...noopTimer });

    await shutdown('SIGTERM');

    expect(order).toEqual(['server', 'pool']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ist idempotent (zweites Signal löst keinen zweiten Lauf aus)', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const { shutdown } = createGracefulShutdown({ closers: [{ name: 'x', close }], logger: silentLogger, exit, ...noopTimer });

    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('ein fehlschlagender Closer blockiert die übrigen nicht; Exit bleibt 0', async () => {
    const order = [];
    const exit = jest.fn();
    const closers = [
      { name: 'a', close: async () => { order.push('a'); throw new Error('boom'); } },
      { name: 'b', close: async () => { order.push('b'); } },
    ];
    const { shutdown } = createGracefulShutdown({ closers, logger: silentLogger, exit, ...noopTimer });

    await shutdown('SIGTERM');

    expect(order).toEqual(['a', 'b']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('Force-Exit (Code 1), wenn ein Closer hängt', async () => {
    let timerCb;
    const exit = jest.fn();
    const hang = { name: 'hang', close: () => new Promise(() => {}) }; // hängt für immer
    const { shutdown } = createGracefulShutdown({
      closers: [hang],
      logger: silentLogger,
      exit,
      setTimeoutFn: (fn) => { timerCb = fn; return { unref() {} }; },
      clearTimeoutFn: () => {},
    });

    shutdown('SIGTERM'); // NICHT awaiten (hängt)
    await Promise.resolve();
    timerCb();           // Force-Timer feuert

    expect(exit).toHaveBeenCalledWith(1);
  });
});
