'use strict';

// Unit-Tests für ipAllowlistGuard — Fail-safe-Verhalten + Durchsetzung.

const { createIpAllowlistGuard } = require('../../src/middleware/ipAllowlistGuard');

function makeRepo(enabled, cidrs) {
  return {
    get: jest.fn((key) => {
      if (key === 'platform_ipAllowlistEnabled') return Promise.resolve(enabled);
      if (key === 'platform_ipAllowlistCidrs')   return Promise.resolve(cidrs);
      return Promise.resolve(null);
    }),
  };
}

function makeReq(ip, path = '/api/v1/tickets') {
  return { ip, path };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('ipAllowlistGuard — deaktiviert', () => {
  it('lässt alle durch wenn aus', async () => {
    const guard = createIpAllowlistGuard();
    await guard.refreshIpAllowlist(makeRepo(false, '10.0.0.0/8'));
    const next = jest.fn();
    guard.middleware(makeReq('8.8.8.8'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt alle durch wenn aktiviert aber Liste leer (fail-safe)', async () => {
    const guard = createIpAllowlistGuard();
    await guard.refreshIpAllowlist(makeRepo(true, ''));
    const next = jest.fn();
    guard.middleware(makeReq('8.8.8.8'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('ipAllowlistGuard — aktiviert mit Liste', () => {
  let guard;
  beforeEach(async () => {
    guard = createIpAllowlistGuard();
    await guard.refreshIpAllowlist(makeRepo(true, '10.0.0.0/8, 192.168.241.0/24'));
  });

  it('lässt erlaubte IP durch', () => {
    const next = jest.fn();
    guard.middleware(makeReq('10.99.99.75'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blockt nicht-erlaubte IP mit 403', () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq('8.8.8.8'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'IP_NOT_ALLOWED' }));
  });

  it('lässt /health immer durch (auch von blockierter IP)', () => {
    const next = jest.fn();
    guard.middleware(makeReq('8.8.8.8', '/api/v1/health'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('befreit NICHT versehentlich /tickets/health-check (exakter Segment-Match)', () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq('8.8.8.8', '/api/v1/tickets/health-check'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('ipAllowlistGuard — setIpAllowlist wirkt sofort', () => {
  it('aktualisiert Cache ohne Repo', () => {
    const guard = createIpAllowlistGuard();
    guard.setIpAllowlist(true, '172.16.0.0/12');
    const blocked = jest.fn();
    const res = makeRes();
    guard.middleware(makeReq('8.8.8.8'), res, blocked);
    expect(res.status).toHaveBeenCalledWith(403);

    const allowed = jest.fn();
    guard.middleware(makeReq('172.16.5.5'), makeRes(), allowed);
    expect(allowed).toHaveBeenCalledWith();
  });
});
