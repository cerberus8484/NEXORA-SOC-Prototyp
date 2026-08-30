'use strict';

const request  = require('supertest');
const app      = require('../../src/app');
const { signWebhook }        = require('../../src/integrations/hmac');
const { integrationService } = require('../../src/integrations/IntegrationService');
const { auditService }       = require('../../src/services/AuditService');

const { mapLevelToPriority, mapTimestamp, extractIPs, extractMitre, mapAlertToNormalized } =
  require('../../src/integrations/adapters/wazuh/wazuhMapper');
const { WazuhAdapter }       = require('../../src/integrations/adapters/wazuh/WazuhAdapter');

const TEST_SECRET = 'dev-webhook-secret-change-in-production';

function signedPost(body) {
  const rawBody   = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(TEST_SECRET, timestamp, rawBody);
  return request(app)
    .post('/api/v1/integrations/wazuh/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

function minimalAlert(overrides = {}) {
  return {
    id: '1234567890.1',
    rule: { id: '5503', level: 7, description: 'Multiple authentication failures.' },
    agent: { id: '001', name: 'agent01', ip: '192.168.241.10' },
    timestamp: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  integrationService._repo.clear();
  auditService.clearLog();
  process.env.WEBHOOK_SECRET_WAZUH = TEST_SECRET;
});

// ── mapLevelToPriority ────────────────────────────────────────

describe('mapLevelToPriority', () => {
  test.each([
    [0,  'info'],
    [1,  'low'],
    [3,  'low'],
    [4,  'medium'],
    [7,  'medium'],
    [8,  'high'],
    [11, 'high'],
    [12, 'critical'],
    [15, 'critical'],
  ])('level %i → %s', (level, expected) => {
    expect(mapLevelToPriority(level)).toBe(expected);
  });
});

// ── mapTimestamp ──────────────────────────────────────────────

describe('mapTimestamp', () => {
  test('ISO-String wird normalisiert', () => {
    const ts = mapTimestamp('2024-06-01T12:00:00.000Z');
    expect(ts).toBe('2024-06-01T12:00:00.000Z');
  });

  test('Unix-ms wird zu ISO', () => {
    const ts = mapTimestamp(1717243200000);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('null → leer', () => {
    expect(mapTimestamp(null)).toBe('');
  });

  test('ungültiger String → leer', () => {
    expect(mapTimestamp('not-a-date')).toBe('');
  });
});

// ── extractIPs ────────────────────────────────────────────────

describe('extractIPs', () => {
  test('srcip aus data', () => {
    const { srcIp } = extractIPs({ data: { srcip: '10.0.0.5' }, agent: {} });
    expect(srcIp).toBe('10.0.0.5');
  });

  test('agent.ip ist NICHT srcIp (Maskerade entfernt) → srcIp leer, sensorIp = agent.ip', () => {
    const { srcIp, sensorIp } = extractIPs({ data: {}, agent: { ip: '192.168.241.10' } });
    expect(srcIp).toBe('');
    expect(sensorIp).toBe('192.168.241.10');
  });

  test('Cowrie src_ip → srcIp UND attackerIp (agent.ip bleibt nur sensorIp)', () => {
    const { srcIp, attackerIp, sensorIp } = extractIPs({ data: { src_ip: '185.220.101.45' }, agent: { ip: '10.99.99.80' } });
    expect(srcIp).toBe('185.220.101.45');
    expect(attackerIp).toBe('185.220.101.45');
    expect(sensorIp).toBe('10.99.99.80');
  });

  test('Firewall srcip → srcIp, aber attackerIp leer (kein Honeypot)', () => {
    const { srcIp, attackerIp } = extractIPs({ data: { srcip: '9.9.9.9' }, agent: {} });
    expect(srcIp).toBe('9.9.9.9');
    expect(attackerIp).toBe('');
  });

  test('dstip aus data', () => {
    const { dstIp } = extractIPs({ data: { dstip: '10.0.0.1' }, agent: {} });
    expect(dstIp).toBe('10.0.0.1');
  });
});

// ── extractMitre ──────────────────────────────────────────────

describe('extractMitre', () => {
  test('MITRE-Felder korrekt extrahiert', () => {
    const payload = {
      rule: {
        id: '100', level: 10,
        mitre: { id: ['T1110'], tactic: ['Credential Access'], technique: ['Brute Force'] },
      },
    };
    const m = extractMitre(payload);
    expect(m.techniqueIds).toEqual(['T1110']);
    expect(m.tactics).toEqual(['Credential Access']);
    expect(m.techniques).toEqual(['Brute Force']);
  });

  test('fehlendes mitre → leere Arrays', () => {
    const m = extractMitre({ rule: { id: '1', level: 5 } });
    expect(m.techniqueIds).toEqual([]);
    expect(m.tactics).toEqual([]);
  });
});

// ── mapAlertToNormalized ──────────────────────────────────────

describe('mapAlertToNormalized', () => {
  test('Pflichtfelder vorhanden', () => {
    const n = mapAlertToNormalized(minimalAlert());
    expect(n.source).toBe('wazuh');
    expect(n.externalId).toMatch(/^wazuh:rule:/);
    expect(n.title).toContain('Multiple authentication failures');
    expect(n.priority).toBe('medium');
    expect(n.status).toBe('open');
    expect(n.datetime).toBe('2024-06-01T12:00:00.000Z');
  });

  test('Evidence enthält raw payload', () => {
    const raw = minimalAlert();
    const n   = mapAlertToNormalized(raw);
    expect(n.evidence[0].type).toBe('wazuh_alert');
    expect(n.evidence[0].raw).toBe(raw);
  });

  test('category aus rule.groups', () => {
    const payload = minimalAlert({ rule: { id: '1', level: 5, groups: ['authentication_failed', 'syslog'] } });
    const n = mapAlertToNormalized(payload);
    expect(n.category).toContain('authentication_failed');
  });

  test('MITRE in normalizedData enthalten', () => {
    const payload = minimalAlert();
    payload.rule.mitre = { id: ['T1110'], tactic: ['Credential Access'], technique: ['Brute Force'] };
    const n = mapAlertToNormalized(payload);
    expect(n.mitre.techniqueIds).toEqual(['T1110']);
  });
});

// ── WazuhAdapter ──────────────────────────────────────────────

describe('WazuhAdapter', () => {
  const adapter = new WazuhAdapter();

  test('validate: gültiger Alert → kein Fehler', () => {
    expect(() => adapter.validate(minimalAlert())).not.toThrow();
  });

  test('validate: fehlende rule → ValidationError', () => {
    expect(() => adapter.validate({ id: '1', timestamp: '2024-01-01T00:00:00Z' }))
      .toThrow('ungültig');
  });

  test('validate: kein Objekt → ValidationError', () => {
    expect(() => adapter.validate(null)).toThrow('JSON-Objekt');
  });

  test('normalize: gibt externalId zurück', () => {
    const n = adapter.normalize(minimalAlert());
    expect(n.externalId).toMatch(/^wazuh:rule:5503:/);
  });

  test('toTicketDraft: enthält Pflichtfelder', () => {
    const n     = adapter.normalize(minimalAlert());
    const draft = adapter.toTicketDraft(n);
    expect(draft.title).toBeTruthy();
    expect(draft.priority).toBe('medium');
    expect(draft.source).toBe('wazuh');
  });
});

// ── Webhook-Endpunkt ──────────────────────────────────────────

describe('POST /api/v1/integrations/wazuh/webhook', () => {
  test('gültiger Alert → 202', async () => {
    const res = await signedPost(minimalAlert());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.eventId).toBeTruthy();
  });

  test('fehlende rule → 400', async () => {
    const res = await signedPost({ id: '1', timestamp: '2024-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('fehlendes Webhook-Secret → 401', async () => {
    delete process.env.WEBHOOK_SECRET_WAZUH;
    delete process.env.WEBHOOK_SECRET_GENERIC;
    const res = await request(app)
      .post('/api/v1/integrations/wazuh/webhook')
      .send(minimalAlert());
    expect(res.status).toBe(401);
  });

  test('duplikater Alert → 200', async () => {
    const body = minimalAlert();
    await signedPost(body);
    const res  = await signedPost(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');
  });

  test('Event landet im Repository', async () => {
    await signedPost(minimalAlert());
    const events = await integrationService._repo.findAll();
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('wazuh');
    expect(['normalized', 'queued', 'processed']).toContain(events[0].status);
  });

  test('critical Alert (level 14) → priority critical', async () => {
    await signedPost(minimalAlert({ rule: { id: '9999', level: 14, description: 'Rootkit detected' } }));
    const events = await integrationService._repo.findAll();
    expect(events[0].normalizedData.priority).toBe('critical');
  });
});
