'use strict';

const express = require('express');
const request = require('supertest');
const app     = require('../../src/app');

describe('GET /api/v1/health', () => {
  it('gibt 200 + status ok zurück', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('enthält service, uptime, timestamp, requestId', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body).toMatchObject({
      service: 'soc-ticket-api',
      status:  'ok',
    });
    expect(res.body.uptime).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.requestId).toBeDefined();
  });

  it('liefert die App-Version (für authentifizierte Admin-Seiten Settings/SystemStatus)', async () => {
    const { version } = require('../../package.json');
    const res = await request(app).get('/api/v1/health');
    expect(res.body.version).toBe(version);
  });

  it('setzt X-Request-Id Header', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('setzt Security Headers (helmet)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('gibt 404 für unbekannte Route', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('prueft die DB nicht, wenn DB_ENABLED=false ist, auch wenn DB_HOST gesetzt ist', async () => {
    const savedEnabled = process.env.DB_ENABLED;
    const savedHost = process.env.DB_HOST;
    process.env.DB_ENABLED = 'false';
    process.env.DB_HOST = 'postgres.internal';

    const check = jest.fn().mockResolvedValue({ db: 'ok' });
    jest.resetModules();
    jest.doMock('../../src/services/dbHealthInstance', () => ({
      dbHealthChecker: { check },
    }));

    const isolatedApp = express();
    isolatedApp.use((req, _res, next) => { req.id = 'test-health'; next(); });
    isolatedApp.use('/', require('../../src/routes/health'));

    const res = await request(isolatedApp).get('/');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('not_configured');
    expect(check).not.toHaveBeenCalled();

    jest.dontMock('../../src/services/dbHealthInstance');
    jest.resetModules();
    if (savedEnabled === undefined) delete process.env.DB_ENABLED; else process.env.DB_ENABLED = savedEnabled;
    if (savedHost === undefined) delete process.env.DB_HOST; else process.env.DB_HOST = savedHost;
  });
});
