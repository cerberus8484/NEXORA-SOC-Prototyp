'use strict';

const { createDbHealthChecker, defaultWithTimeout } = require('../../src/services/dbHealthChecker');

describe('createDbHealthChecker', () => {
  it('ping ok → { db: ok }, innerhalb TTL aus dem Cache (ping nur einmal)', async () => {
    let clock = 1000;
    const ping = jest.fn().mockResolvedValue(true);
    const checker = createDbHealthChecker({ ping, ttlMs: 3000, now: () => clock });

    expect((await checker.check()).db).toBe('ok');
    clock = 2000; // < ttl
    expect((await checker.check()).db).toBe('ok');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('nach TTL-Ablauf wird erneut geprüft', async () => {
    let clock = 1000;
    const ping = jest.fn().mockResolvedValue(true);
    const checker = createDbHealthChecker({ ping, ttlMs: 3000, now: () => clock });
    await checker.check();
    clock = 5000; // > ttl
    await checker.check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('ping-Fehler → { db: error } statt Throw (fehlersicher)', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const checker = createDbHealthChecker({ ping, now: () => 1000 });
    const r = await checker.check();
    expect(r.db).toBe('error');
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('Timeout (hängender Ping) → { db: error }', async () => {
    const ping = jest.fn(() => new Promise(() => {})); // hängt für immer
    const withTimeout = () => Promise.reject(new Error('health_ping_timeout'));
    const checker = createDbHealthChecker({ ping, withTimeout, now: () => 1000 });
    const r = await checker.check();
    expect(r.db).toBe('error');
    expect(r.error).toContain('timeout');
  });

  it('Single-Flight: gleichzeitige Aufrufe lösen nur EINEN Ping aus', async () => {
    let resolvePing;
    const ping = jest.fn(() => new Promise((res) => { resolvePing = res; }));
    const checker = createDbHealthChecker({ ping, now: () => 1000 });
    const p1 = checker.check();
    const p2 = checker.check();
    resolvePing(true);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.db).toBe('ok');
    expect(r2.db).toBe('ok');
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe('defaultWithTimeout', () => {
  it('löst auf, wenn das Promise vor dem Timeout fertig ist', async () => {
    await expect(defaultWithTimeout(Promise.resolve('x'), 1000)).resolves.toBe('x');
  });

  it('lehnt mit health_ping_timeout ab, wenn das Promise hängt', async () => {
    const hang = new Promise(() => {});
    await expect(defaultWithTimeout(hang, 10)).rejects.toThrow('health_ping_timeout');
  });
});
