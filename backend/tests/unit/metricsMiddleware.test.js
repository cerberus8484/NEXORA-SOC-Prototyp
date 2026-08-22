'use strict';

const EventEmitter = require('events');
const { metrics, registry } = require('../../src/metrics/metricsRegistry');
const metricsMiddleware = require('../../src/middleware/metricsMiddleware');

function fakeReqRes({ method = 'GET', url = '/v1/tickets/abc123?x=1', status = 200 } = {}) {
  const req = { method, path: url.split('?')[0], originalUrl: url, url };
  const res = new EventEmitter();
  res.statusCode = status;
  return { req, res };
}

async function counterValue(metric, labels) {
  const data = await metric.get();
  const entry = data.values.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === String(val)));
  return entry ? entry.value : 0;
}
async function gaugeValue(metric) {
  const data = await metric.get();
  return data.values.length ? data.values[0].value : 0;
}

describe('metricsMiddleware', () => {
  it('zählt In-Flight hoch und nach finish wieder runter', async () => {
    const { req, res } = fakeReqRes();
    const before = await gaugeValue(metrics.httpRequestsInFlight);
    metricsMiddleware(req, res, () => {});
    expect(await gaugeValue(metrics.httpRequestsInFlight)).toBe(before + 1);
    res.emit('finish');
    expect(await gaugeValue(metrics.httpRequestsInFlight)).toBe(before);
  });

  it('normalisiert die Route — keine UUID/kein Querystring im Label-Raum', async () => {
    const url = '/v1/tickets/3f2504e0-4f89-41d3-9a0c-0305e82c3301?limit=10';
    const { req, res } = fakeReqRes({ url, status: 200 });
    const labels = { method: 'GET', route: '/v1/tickets/:id', status_code: 200 };
    const before = await counterValue(metrics.httpRequestsTotal, labels);
    metricsMiddleware(req, res, () => {});
    res.emit('finish');
    expect(await counterValue(metrics.httpRequestsTotal, labels)).toBe(before + 1);

    const text = await registry.metrics();
    expect(text).not.toContain('3f2504e0-4f89');
    expect(text).not.toContain('limit=10');
  });

  it('Fehlerrequest (500) erhöht die Zählung mit status_code=500', async () => {
    const { req, res } = fakeReqRes({ method: 'POST', url: '/v1/tickets', status: 500 });
    const labels = { method: 'POST', route: '/v1/tickets', status_code: 500 };
    const before = await counterValue(metrics.httpRequestsTotal, labels);
    metricsMiddleware(req, res, () => {});
    res.emit('finish');
    expect(await counterValue(metrics.httpRequestsTotal, labels)).toBe(before + 1);
  });

  it('In-Flight wird auch bei Abbruch (close ohne finish) verringert', async () => {
    const { req, res } = fakeReqRes();
    const before = await gaugeValue(metrics.httpRequestsInFlight);
    metricsMiddleware(req, res, () => {});
    expect(await gaugeValue(metrics.httpRequestsInFlight)).toBe(before + 1);
    res.emit('close');
    expect(await gaugeValue(metrics.httpRequestsInFlight)).toBe(before);
  });

  it('überspringt den /metrics-Pfad selbst (kein In-Flight-Effekt)', () => {
    const req = { method: 'GET', path: '/metrics', originalUrl: '/metrics', url: '/metrics' };
    const res = new EventEmitter();
    let nextCalled = false;
    metricsMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.listenerCount('finish')).toBe(0);
  });
});
