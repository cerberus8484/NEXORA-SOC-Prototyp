'use strict';

// ── Block B.3: Rate-Limit auf POST /api/v1/agent/propose ────────────────────
// /propose stößt einen teuren LLM-Call an. Ohne Limit könnte ein kompromittiertes
// Konto das KI-Backend fluten. Der Limiter ist im Test default-inaktiv und wird
// hier per AGENT_PROPOSE_MAX explizit scharf geschaltet (muss VOR dem app-Require
// gesetzt sein — der Limiter liest die ENV beim Modul-Load).

process.env.AGENT_PROPOSE_MAX = '1';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let token;

beforeAll(async () => {
  const email = `propose-rl-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

afterAll(() => { delete process.env.AGENT_PROPOSE_MAX; });

describe('POST /api/v1/agent/propose — Rate-Limit (AGENT_PROPOSE_MAX=1)', () => {
  test('zweite Anfrage im Fenster wird mit 429 abgewiesen', async () => {
    const send = () => request(app)
      .post('/api/v1/agent/propose')
      .set('Authorization', `Bearer ${token}`)
      .send({ ticketId: 'INC-does-not-exist', kind: 'triage' });

    // 1. Anfrage: passiert den Limiter (Status egal — Ticket existiert nicht → 404,
    //    aber NICHT 429). 2. Anfrage: vom Limiter geblockt → 429.
    const first = await send();
    expect(first.status).not.toBe(429);

    const second = await send();
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('TOO_MANY_REQUESTS');
  });
});
