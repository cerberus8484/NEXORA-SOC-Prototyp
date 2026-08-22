'use strict';

// TDD RED-Phase: Unit-Tests für maintenanceGuard.js
// Prüft: on → non-admin 503, admin passt, /health frei; off → alle passieren; Cache-Refresh wirkt.

const { createMaintenanceGuard } = require('../../src/middleware/maintenanceGuard');

function makeMockRepo(maintenanceModeValue) {
  return {
    get: jest.fn().mockResolvedValue(maintenanceModeValue),
  };
}

function makeReq(role, path = '/api/v1/tickets') {
  return { user: { role }, path };
}

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  };
  return res;
}

describe('maintenanceGuard — Maintenance OFF', () => {
  let guard;

  beforeEach(async () => {
    const repo = makeMockRepo(false);
    guard = createMaintenanceGuard();
    await guard.refreshMaintenance(repo);
  });

  it('lässt Admin durch', async () => {
    const next = jest.fn();
    guard.middleware(makeReq('admin'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt Analyst durch', async () => {
    const next = jest.fn();
    guard.middleware(makeReq('analyst'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt Viewer durch', async () => {
    const next = jest.fn();
    guard.middleware(makeReq('viewer'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt nicht-authentifizierte Requests durch (maintenance off)', async () => {
    const next = jest.fn();
    const req  = { user: undefined, path: '/api/v1/tickets' };
    guard.middleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('maintenanceGuard — Maintenance ON', () => {
  let guard;

  beforeEach(async () => {
    const repo = makeMockRepo(true);
    guard = createMaintenanceGuard();
    await guard.refreshMaintenance(repo);
  });

  it('lässt Admin passieren (503-Ausnahme)', async () => {
    const next = jest.fn();
    guard.middleware(makeReq('admin'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt Engineer passieren (503-Ausnahme wie Admin)', async () => {
    const next = jest.fn();
    guard.middleware(makeReq('engineer'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('gibt 503 für Analyst zurück', async () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq('analyst'), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'MAINTENANCE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('gibt 503 für Viewer zurück', async () => {
    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq('viewer'), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('gibt 503 für nicht-authentifizierte Requests zurück', async () => {
    const next = jest.fn();
    const res  = makeRes();
    const req  = { user: undefined, path: '/api/v1/tickets' };
    guard.middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('lässt /health frei (immer erreichbar)', async () => {
    const next = jest.fn();
    const req  = { user: undefined, path: '/api/v1/health' };
    guard.middleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt /auth/* frei (Login muss funktionieren)', async () => {
    const next = jest.fn();
    const req  = { user: undefined, path: '/api/v1/auth/login' };
    guard.middleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('lässt GET /settings/platform frei (für Login-Screen-Branding)', async () => {
    // Ein Nicht-Admin-Request auf /settings/platform darf nicht 503 bekommen,
    // damit das Frontend den Plattformnamen laden kann.
    const next = jest.fn();
    const req  = { user: { role: 'analyst' }, path: '/api/v1/settings/platform', method: 'GET' };
    guard.middleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('maintenanceGuard — Cache-Refresh', () => {
  it('Cache-Refresh von false → true blockiert dann Analyst', async () => {
    const guard = createMaintenanceGuard();
    await guard.refreshMaintenance(makeMockRepo(false));

    // Vor Refresh: Analyst durch
    const next1 = jest.fn();
    guard.middleware(makeReq('analyst'), makeRes(), next1);
    expect(next1).toHaveBeenCalledWith();

    // Refresh auf true
    await guard.refreshMaintenance(makeMockRepo(true));

    // Nach Refresh: Analyst geblockt
    const next2 = jest.fn();
    const res2  = makeRes();
    guard.middleware(makeReq('analyst'), res2, next2);
    expect(res2.status).toHaveBeenCalledWith(503);
    expect(next2).not.toHaveBeenCalled();
  });

  it('setMaintenance(true) ohne Repo wirkt sofort', async () => {
    const guard = createMaintenanceGuard();
    guard.setMaintenance(true);

    const next = jest.fn();
    const res  = makeRes();
    guard.middleware(makeReq('viewer'), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('setMaintenance(false) hebt Blockade auf', async () => {
    const guard = createMaintenanceGuard();
    guard.setMaintenance(true);
    guard.setMaintenance(false);

    const next = jest.fn();
    guard.middleware(makeReq('viewer'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
