import { describe, it, expect } from 'vitest';
import {
  type WebhookReceiver,
  type RateLimit,
  formatWindowMs,
  formatMaxRequests,
  buildBaseUrl,
} from './apiWebhooksApi';

// ── Typen: Invariante kein Secret-Feld ───────────────────────────────────────

describe('ApiInfoData Typ-Invariante: kein Secret-Feld', () => {
  it('WebhookReceiver hat keine Secret-Felder', () => {
    const receiver: WebhookReceiver = {
      source:         'wazuh',
      path:           '/api/v1/integrations/wazuh/webhook',
      hmacConfigured: true,
    };

    const SECRET_FIELDS = ['secret', 'key', 'password', 'token', 'apiKey', 'api_key', 'hmacSecret'];
    for (const field of SECRET_FIELDS) {
      expect(receiver).not.toHaveProperty(field);
    }
  });

  it('hmacConfigured ist boolean — kein String', () => {
    const r: WebhookReceiver = { source: 'qradar', path: '/api/v1/integrations/qradar/webhook', hmacConfigured: false };
    expect(typeof r.hmacConfigured).toBe('boolean');
  });
});

// ── formatWindowMs ────────────────────────────────────────────────────────────

describe('formatWindowMs', () => {
  it('60000 ms → "1 Minute"', () => {
    expect(formatWindowMs(60_000)).toBe('1 Minute');
  });

  it('120000 ms → "2 Minuten"', () => {
    expect(formatWindowMs(120_000)).toBe('2 Minuten');
  });

  it('30000 ms (unter 1 Min) → "30 Sekunden"', () => {
    expect(formatWindowMs(30_000)).toBe('30 Sekunden');
  });

  it('0 ms → "0 Sekunden"', () => {
    expect(formatWindowMs(0)).toBe('0 Sekunden');
  });

  it('3600000 ms (1h) → "60 Minuten"', () => {
    expect(formatWindowMs(3_600_000)).toBe('60 Minuten');
  });
});

// ── formatMaxRequests ─────────────────────────────────────────────────────────

describe('formatMaxRequests', () => {
  it('200, windowMs 60000 → "200 Requests / Minute"', () => {
    expect(formatMaxRequests(200, 60_000)).toBe('200 Requests / Minute');
  });

  it('1000, windowMs 60000 → "1000 Requests / Minute"', () => {
    expect(formatMaxRequests(1_000, 60_000)).toBe('1000 Requests / Minute');
  });

  it('500, windowMs 30000 → "500 Requests / 30 Sekunden"', () => {
    expect(formatMaxRequests(500, 30_000)).toBe('500 Requests / 30 Sekunden');
  });
});

// ── buildBaseUrl ──────────────────────────────────────────────────────────────

describe('buildBaseUrl', () => {
  it('gibt die konfigurierte API-Basis zurück (ohne trailing slash)', () => {
    const url = buildBaseUrl('/api/v1');
    expect(url).toBe('/api/v1');
  });

  it('entfernt trailing slash', () => {
    const url = buildBaseUrl('/api/v1/');
    expect(url).toBe('/api/v1');
  });

  it('leerer String → leerer String', () => {
    expect(buildBaseUrl('')).toBe('');
  });

  it('absoluter Pfad bleibt erhalten', () => {
    expect(buildBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });
});

// ── RateLimit Typ-Validierung ─────────────────────────────────────────────────

describe('RateLimit Typ-Validierung', () => {
  it('RateLimit hat max, windowMs, webhookMax als Zahlen', () => {
    const rl: RateLimit = { max: 200, windowMs: 60_000, webhookMax: 1_000 };
    expect(typeof rl.max).toBe('number');
    expect(typeof rl.windowMs).toBe('number');
    expect(typeof rl.webhookMax).toBe('number');
  });
});
