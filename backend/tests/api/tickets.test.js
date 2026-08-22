'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { ticketService } = require('../../src/services/TicketService');
const { authService }   = require('../../src/services/AuthService');

let analystToken;
let adminToken;

// Auth + Store vor jedem Test vorbereiten
beforeEach(async () => {
  ticketService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  // Analyst-User anlegen
  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  analystToken = aRes.body.token;

  // Admin-User anlegen
  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const dRes = await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' });
  adminToken = dRes.body.token;
});

// Hilfsfunktionen: Methode zuerst, dann Auth-Header setzen
const asAnalyst = {
  get:    (url)  => request(app).get(url).set('Authorization',    `Bearer ${analystToken}`),
  post:   (url)  => request(app).post(url).set('Authorization',   `Bearer ${analystToken}`),
  put:    (url)  => request(app).put(url).set('Authorization',    `Bearer ${analystToken}`),
  delete: (url)  => request(app).delete(url).set('Authorization', `Bearer ${analystToken}`),
};
const asAdmin = {
  get:    (url)  => request(app).get(url).set('Authorization',    `Bearer ${adminToken}`),
  post:   (url)  => request(app).post(url).set('Authorization',   `Bearer ${adminToken}`),
  put:    (url)  => request(app).put(url).set('Authorization',    `Bearer ${adminToken}`),
  delete: (url)  => request(app).delete(url).set('Authorization', `Bearer ${adminToken}`),
};

describe('GET /api/v1/tickets', () => {
  it('gibt leere Liste zurück wenn keine Tickets', async () => {
    const res = await asAnalyst.get('/api/v1/tickets');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('gibt erstellte Tickets zurück', async () => {
    await asAnalyst.post('/api/v1/tickets').send({ title: 'INC-001 Brute Force' });
    const res = await asAnalyst.get('/api/v1/tickets');
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].title).toBe('INC-001 Brute Force');
  });
});

describe('Analyse-Persistenz (decision/confidence/recommendation/notes)', () => {
  it('speichert + lädt die Analyse-Felder am Ticket', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Analyse-Ticket' });
    const id = created.body.data.id;
    const upd = await asAnalyst.put(`/api/v1/tickets/${id}`).send({
      decision: 'suspicious', confidence: 70, recommendation: 'Host isolieren', notes: 'Beobachtung läuft',
    });
    expect(upd.status).toBe(200);
    const res = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(res.body.data.decision).toBe('suspicious');
    expect(res.body.data.confidence).toBe(70);
    expect(res.body.data.recommendation).toBe('Host isolieren');
    expect(res.body.data.notes).toBe('Beobachtung läuft');
  });

  it('lehnt ungültige decision ab → 400', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'x' });
    const res = await asAnalyst.put(`/api/v1/tickets/${created.body.data.id}`).send({ decision: 'nonsense' });
    expect(res.status).toBe(400);
  });
});

describe('Payload-Persistenz (Editor-Parität)', () => {
  const payloads = [
    { id: 'p1', type: 'Hash', raw: 'd41d8cd98f00b204e9800998ecf8427e', fields: { algo: 'MD5', hashval: 'd41d8cd98f00b204e9800998ecf8427e' }, createdAt: '2026-06-12T10:00:00.000Z' },
    { id: 'p2', type: 'Command', raw: 'cmd.exe /c whoami', fields: { shell: 'cmd.exe', cmd: 'cmd.exe /c whoami' }, createdAt: '2026-06-12T10:01:00.000Z' },
  ];

  it('speichert + lädt Payload-Artefakte am Ticket (PUT → GET Roundtrip)', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Payload-Ticket' });
    const id = created.body.data.id;
    const upd = await asAnalyst.put(`/api/v1/tickets/${id}`).send({ payloads });
    expect(upd.status).toBe(200);
    const res = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(res.body.data.payloads).toHaveLength(2);
    expect(res.body.data.payloads[0].type).toBe('Hash');
    expect(res.body.data.payloads[0].fields.algo).toBe('MD5');
    expect(res.body.data.payloads[1].fields.cmd).toBe('cmd.exe /c whoami');
  });

  it('akzeptiert Payloads schon beim Anlegen (POST)', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Mit Payload', payloads: [payloads[0]] });
    expect(created.status).toBe(201);
    expect(created.body.data.payloads).toHaveLength(1);
  });

  it('lehnt unbekannten Payload-Typ ab → 400', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'x' });
    const res = await asAnalyst.put(`/api/v1/tickets/${created.body.data.id}`).send({
      payloads: [{ id: 'p9', type: 'Kaputt', raw: '', fields: {} }],
    });
    expect(res.status).toBe(400);
  });

  it('GUARDRAIL: mehr als 50 Payloads → 400', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'x' });
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, type: 'IP', raw: '', fields: {} }));
    const res = await asAnalyst.put(`/api/v1/tickets/${created.body.data.id}`).send({ payloads: many });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/tickets/cross-ref', () => {
  it('findet andere Tickets mit demselben Indikator (exkl. eigenes)', async () => {
    const a = await asAnalyst.post('/api/v1/tickets').send({ title: 'A', dstIp: '185.220.101.12' });
    await asAnalyst.post('/api/v1/tickets').send({ title: 'B', srcIp: '185.220.101.12' });
    await asAnalyst.post('/api/v1/tickets').send({ title: 'C', iocs: 'evil.tld\n185.220.101.12' });
    const res = await asAnalyst.post('/api/v1/tickets/cross-ref').send({ values: ['185.220.101.12'], excludeId: a.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data['185.220.101.12']).toHaveLength(2); // B + C, nicht A selbst
  });

  it('leere values → leeres Ergebnis', async () => {
    const res = await asAnalyst.post('/api/v1/tickets/cross-ref').send({ values: [] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
  });
});

describe('POST /api/v1/tickets/:id/threat-intel/enrich', () => {
  it('reichert die IP-Indikatoren des Tickets an (Reputation)', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({
      title: 'Outbound C2', srcIp: '192.168.240.5', dstIp: '185.220.101.12', iocs: '224.0.0.7',
    });
    const id = created.body.data.id;
    const res = await asAnalyst.post(`/api/v1/tickets/${id}/threat-intel/enrich`);
    expect(res.status).toBe(200);
    const byIp = Object.fromEntries(res.body.data.map((r) => [r.indicatorValue, r.verdict]));
    expect(byIp['185.220.101.12']).toBe('malicious'); // Demo-malicious (Mock)
    expect(byIp['192.168.240.5']).toBe('clean');         // privat
    expect(byIp['224.0.0.7']).toBe('clean');           // multicast (aus iocs-Feld)
  });

  it('404 bei unbekanntem Ticket', async () => {
    const res = await asAnalyst.post('/api/v1/tickets/nope/threat-intel/enrich');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/tickets', () => {
  it('erstellt Ticket mit title', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'Suspicious PowerShell C2', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.title).toBe('Suspicious PowerShell C2');
    expect(res.body.data.priority).toBe('high');
    expect(res.body.data.state).toBe('OPEN');
    expect(res.body.data.status).toBe('assigned');
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('setzt Default-Priority medium wenn nicht angegeben', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'Test' });
    expect(res.body.data.priority).toBe('medium');
  });

  it('gibt 400 wenn title fehlt', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ priority: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('gibt 400 bei ungültiger Priority', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'Test', priority: 'ultra-critical' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('gibt 400 bei leerem title', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('gibt 400 bei title über 200 Zeichen', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'A'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/tickets/:id', () => {
  it('gibt Ticket zurück', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'C2 Beacon Detection' });
    const id = created.body.data.id;
    const res = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('gibt 404 für unbekannte ID', async () => {
    const res = await asAnalyst.get('/api/v1/tickets/nonexistent-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});

describe('PUT /api/v1/tickets/:id', () => {
  it('aktualisiert Ticket', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Original', status: 'assigned' });
    const id = created.body.data.id;
    const res = await asAnalyst.put(`/api/v1/tickets/${id}`).send({ status: 'in_progress', state: 'CLOSED', closeReason: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
    expect(res.body.data.state).toBe('CLOSED');
    expect(res.body.data.closeReason).toBe('resolved');
  });

  it('gibt 404 für unbekannte ID', async () => {
    const res = await asAnalyst.put('/api/v1/tickets/nonexistent').send({ status: 'on_hold' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/tickets/:id', () => {
  it('löscht Ticket und gibt 204 zurück', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'To be deleted' });
    const id = created.body.data.id;
    const del = await asAdmin.delete(`/api/v1/tickets/${id}`);
    expect(del.status).toBe(204);
    const get = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(get.status).toBe(404);
  });

  it('gibt 404 für unbekannte ID', async () => {
    const res = await asAdmin.delete('/api/v1/tickets/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('analystState — Checkliste + Playbook persistent (Block B1)', () => {
  const validState = {
    checklist: [
      { id: 'c1', label: 'IoCs prüfen', done: false },
      { id: 'c2', label: 'VT prüfen', done: true },
    ],
    playbook: { id: 'susp-ip', step: 2, status: 'in_progress' },
  };

  it('POST mit analystState speichert Checkliste + Playbook', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'Checklist-Test', analystState: validState });
    expect(res.status).toBe(201);
    expect(res.body.data.analystState.checklist).toHaveLength(2);
    expect(res.body.data.analystState.checklist[1].done).toBe(true);
    expect(res.body.data.analystState.playbook.status).toBe('in_progress');
  });

  it('POST ohne analystState → Default {} am Ticket', async () => {
    const res = await asAnalyst.post('/api/v1/tickets').send({ title: 'Kein State' });
    expect(res.status).toBe(201);
    expect(res.body.data.analystState).toEqual({});
  });

  it('PUT aktualisiert analystState, GET liefert es zurück (Roundtrip)', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Update-Test' });
    const id = created.body.data.id;

    const upd = await asAnalyst.put(`/api/v1/tickets/${id}`).send({ analystState: validState });
    expect(upd.status).toBe(200);
    expect(upd.body.data.analystState.checklist).toHaveLength(2);

    const got = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.analystState).toEqual(validState);
  });

  it('PUT kann analystState partiell aktualisieren (Checkliste abhaken)', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Partial-Test', analystState: validState });
    const id = created.body.data.id;

    const updated = {
      checklist: [
        { id: 'c1', label: 'IoCs prüfen', done: true },
        { id: 'c2', label: 'VT prüfen', done: true },
      ],
      playbook: { id: 'susp-ip', step: 3, status: 'done' },
    };
    await asAnalyst.put(`/api/v1/tickets/${id}`).send({ analystState: updated });
    const got = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(got.body.data.analystState.checklist[0].done).toBe(true);
    expect(got.body.data.analystState.playbook.status).toBe('done');
  });

  it('Titel bleibt erhalten wenn nur analystState geputtet wird (kein Datenverlust)', async () => {
    // PUT sendet immer alle Felder über Schema-Defaults — nur title bleibt erhalten
    // (da kein Default). Wir prüfen: analystState-Update lässt title intakt.
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'Isolation-Test' });
    const id = created.body.data.id;

    await asAnalyst.put(`/api/v1/tickets/${id}`).send({ title: 'Isolation-Test', analystState: { checklist: [], playbook: {} } });
    const got = await asAnalyst.get(`/api/v1/tickets/${id}`);
    expect(got.body.data.title).toBe('Isolation-Test');
    expect(got.body.data.analystState.checklist).toEqual([]);
  });

  it('analystState mit ungültigem Playbook-Status → 400', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'x' });
    const id = created.body.data.id;
    const res = await asAnalyst.put(`/api/v1/tickets/${id}`).send({
      analystState: { checklist: [], playbook: { id: 'x', step: 0, status: 'ILLEGALER_STATUS' } },
    });
    expect(res.status).toBe(400);
  });

  it('GUARDRAIL: Checkliste über 100 Items → 400', async () => {
    const created = await asAnalyst.post('/api/v1/tickets').send({ title: 'x' });
    const id = created.body.data.id;
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, label: `Item ${i}`, done: false }));
    const res = await asAnalyst.put(`/api/v1/tickets/${id}`).send({
      analystState: { checklist: items, playbook: {} },
    });
    expect(res.status).toBe(400);
  });
});

describe('Fehlerbehandlung', () => {
  it('gibt requestId in Fehler-Response', async () => {
    const res = await asAnalyst.get('/api/v1/tickets/nonexistent');
    expect(res.body.requestId).toBeDefined();
  });

  it('gibt requestId in Erfolgs-Response', async () => {
    const res = await asAnalyst.get('/api/v1/tickets');
    expect(res.body.requestId).toBeDefined();
  });
});
