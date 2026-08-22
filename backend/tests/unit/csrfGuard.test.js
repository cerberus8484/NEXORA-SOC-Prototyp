'use strict';

// Unit-Tests für csrfGuard (Double-Submit). Nur echte Cookie-Sessions auf
// state-changing Requests werden geprüft; alles andere passiert.

const { csrfGuard } = require('../../src/middleware/csrfGuard');

function makeReq({ method = 'POST', path = '/tickets', cookie, header, authz } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (header) headers['x-csrf-token'] = header;
  if (authz)  headers.authorization = authz;
  return { method, path, headers };
}
function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const cookieWith = (csrf) => `soc_token=abc; csrf_token=${csrf}`;

describe('csrfGuard — durchlassen', () => {
  it('GET (safe method)', () => {
    const next = jest.fn();
    csrfGuard(makeReq({ method: 'GET' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('Bearer-Auth (CSRF-immun)', () => {
    const next = jest.fn();
    csrfGuard(makeReq({ authz: 'Bearer xyz' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('POST /auth/login', () => {
    const next = jest.fn();
    csrfGuard(makeReq({ path: '/auth/login' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('POST /integrations/... (HMAC-Webhook)', () => {
    const next = jest.fn();
    csrfGuard(makeReq({ path: '/integrations/wazuh/webhook' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('unauthentifiziert ohne soc_token-Cookie → durchreichen (requireAuth liefert 401)', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfGuard(makeReq({}), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Cookie-Session mit passendem Double-Submit-Token', () => {
    const next = jest.fn();
    csrfGuard(makeReq({ cookie: cookieWith('tok123'), header: 'tok123' }), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('csrfGuard — blocken (403)', () => {
  it('Cookie-Session ohne X-CSRF-Token-Header', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfGuard(makeReq({ cookie: cookieWith('tok123') }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CSRF' }));
  });

  it('Cookie-Session mit falschem Token', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfGuard(makeReq({ cookie: cookieWith('tok123'), header: 'WRONG' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
