'use strict';

// Unit-Tests für tlsGuard — TLS-Pflicht (default aus), /health frei.

const { createTlsGuard } = require('../../src/middleware/tlsGuard');

function makeRepo(enforce) {
  return { get: jest.fn().mockResolvedValue(enforce) };
}

function makeReq({ secure = false, xfp, path = '/api/v1/tickets' } = {}) {
  return { secure, headers: xfp ? { 'x-forwarded-proto': xfp } : {}, path };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('tlsGuard — deaktiviert', () => {
  it('lässt unverschlüsselte Requests durch', async () => {
    const guard = createTlsGuard();
    await guard.refreshTlsEnforce(makeRepo(false));
    const next = jest.fn();
    guard.middleware(makeReq({ secure: false }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('tlsGuard — aktiviert', () => {
  let guard;
  beforeEach(async () => {
    guard = createTlsGuard();
    await guard.refreshTlsEnforce(makeRepo(true));
  });

  it('blockt HTTP mit 403', () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq({ secure: false }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TLS_REQUIRED' }));
  });

  it('lässt req.secure=true durch', () => {
    const next = jest.fn();
    guard.middleware(makeReq({ secure: true }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt X-Forwarded-Proto: https durch (hinter Proxy)', () => {
    const next = jest.fn();
    guard.middleware(makeReq({ secure: false, xfp: 'https' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt /health immer durch (auch HTTP)', () => {
    const next = jest.fn();
    guard.middleware(makeReq({ secure: false, path: '/api/v1/health' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('befreit NICHT versehentlich /tickets/health-check (exakter Segment-Match)', () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq({ secure: false, path: '/api/v1/tickets/health-check' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('tlsGuard — setTlsEnforce wirkt sofort', () => {
  it('schaltet ohne Repo scharf', () => {
    const guard = createTlsGuard();
    guard.setTlsEnforce(true);
    const res = makeRes();
    guard.middleware(makeReq({ secure: false }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
