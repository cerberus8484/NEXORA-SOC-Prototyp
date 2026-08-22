'use strict';

// P_STABILITY_1 · Task 3a — der pg-Pool muss harte Timeouts tragen, damit keine
// Query unbegrenzt blockiert und die Connection-Reserve kontrollierbar bleibt.
// buildPoolConfig ist rein (liest nur ENV) → ohne DB testbar.

const { buildPoolConfig } = require('../../src/db/poolConfig');

describe('buildPoolConfig', () => {
  it('setzt sichere Default-Timeouts (keine Query blockiert unbegrenzt)', () => {
    const c = buildPoolConfig({});
    expect(c.statement_timeout).toBe(15000);
    expect(c.query_timeout).toBe(20000);
    expect(c.connectionTimeoutMillis).toBe(3000);
    expect(c.idleTimeoutMillis).toBe(30000);
    expect(c.max).toBe(10);
  });

  it('query_timeout >= statement_timeout (Server bricht vor dem Client ab)', () => {
    const c = buildPoolConfig({});
    expect(c.query_timeout).toBeGreaterThanOrEqual(c.statement_timeout);
  });

  it('ENV überschreibt Timeouts und Pool-Größe', () => {
    const c = buildPoolConfig({
      DB_STATEMENT_TIMEOUT_MS: '5000',
      DB_QUERY_TIMEOUT_MS:     '7000',
      DB_CONNECTION_TIMEOUT_MS:'1000',
      DB_POOL_MAX:             '20',
      DB_IDLE_TIMEOUT_MS:      '10000',
    });
    expect(c.statement_timeout).toBe(5000);
    expect(c.query_timeout).toBe(7000);
    expect(c.connectionTimeoutMillis).toBe(1000);
    expect(c.max).toBe(20);
    expect(c.idleTimeoutMillis).toBe(10000);
  });

  it('SSL aus per Default, an (rejectUnauthorized) bei DB_SSL=true', () => {
    expect(buildPoolConfig({}).ssl).toBe(false);
    expect(buildPoolConfig({ DB_SSL: 'true' }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('übernimmt Verbindungsparameter aus ENV', () => {
    const c = buildPoolConfig({ DB_HOST: 'db.local', DB_PORT: '6543', DB_NAME: 'soc', DB_USER: 'u', DB_PASSWORD: 'p' });
    expect(c.host).toBe('db.local');
    expect(c.port).toBe(6543);
    expect(c.database).toBe('soc');
    expect(c.user).toBe('u');
    expect(c.password).toBe('p');
  });
});
