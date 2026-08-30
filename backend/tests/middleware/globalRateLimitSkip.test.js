'use strict';

// Skip-Prädikat des globalen Rate-Limiters. Der authentifizierte Ticket-Triage-
// Hot-Path (Listen-Reload GET /tickets + Status-Update PUT /tickets/:id) soll den
// globalen IP-Topf nicht sprengen — Schließen vieler Tickets in Folge ist normaler
// SOC-Workflow. Alles andere (Login, Create, Delete, Bulk, Export, Suche) bleibt limitiert.

const { makeGlobalRateLimitSkip } = require('../../src/middleware/globalRateLimitSkip');

const skip = makeGlobalRateLimitSkip('/api/v1');
const req = (method, path) => ({ method, path });

describe('globalRateLimitSkip', () => {
  test('Integrations-Webhooks sind ausgenommen (eigener Limiter)', () => {
    expect(skip(req('POST', '/api/v1/integrations/wazuh'))).toBe(true);
  });

  test('GET /tickets (Listen-Reload) ist ausgenommen', () => {
    expect(skip(req('GET', '/api/v1/tickets'))).toBe(true);
  });

  test('PUT /tickets/:id (Status-Update/Close) ist ausgenommen', () => {
    expect(skip(req('PUT', '/api/v1/tickets/2b2d1f3e-0000-0000-0000-000000000001'))).toBe(true);
  });

  test('POST /tickets (Create) bleibt limitiert', () => {
    expect(skip(req('POST', '/api/v1/tickets'))).toBe(false);
  });

  test('DELETE /tickets/:id bleibt limitiert', () => {
    expect(skip(req('DELETE', '/api/v1/tickets/abc'))).toBe(false);
  });

  test('POST /tickets/bulk-delete bleibt limitiert (kein Item-PUT)', () => {
    expect(skip(req('POST', '/api/v1/tickets/bulk-delete'))).toBe(false);
  });

  test('GET /tickets/:id (Einzel-Read) bleibt limitiert', () => {
    expect(skip(req('GET', '/api/v1/tickets/abc'))).toBe(false);
  });

  test('Auth-Routen bleiben limitiert', () => {
    expect(skip(req('POST', '/api/v1/auth/login'))).toBe(false);
    expect(skip(req('GET', '/api/v1/auth/me'))).toBe(false);
  });

  test('PUT auf fremde Ressource wird nicht ausgenommen', () => {
    expect(skip(req('PUT', '/api/v1/users/abc'))).toBe(false);
  });
});
