'use strict';

// ── TDD RED: Tests für notificationOutbound.js ──────────────────────────────
// Reihenfolge:
//   buildSlackPayload   — reine Funktion, kein I/O
//   buildWebhookPayload — reine Funktion, kein I/O
//   deliverOutbound     — injizierter httpPost (Mock), keine echten HTTP-Anfragen
//
// Sicherheits-Invarianten (hart):
//   - skipped wenn outboundEnabled=false (Default)
//   - skipped wenn keine URL konfiguriert
//   - wirft NIE bei httpPost-Fehler (best-effort)
//   - enthält KEINE URL / kein Secret im zurückgegebenen Ergebnis-Objekt

const {
  buildSlackPayload,
  buildWebhookPayload,
  buildTeamsPayload,
  buildEmailPayload,
  buildTestNotification,
  deliverOutbound,
} = require('../../src/services/notificationOutbound');

// ── buildTestNotification ─────────────────────────────────────────────────────

describe('buildTestNotification()', () => {
  test('liefert eine info-Notification mit allen Pflichtfeldern', () => {
    const n = buildTestNotification();
    expect(n.severity).toBe('info');
    expect(typeof n.title).toBe('string');
    expect(n.title).toMatch(/Test/i);
    expect(typeof n.body).toBe('string');
    expect(n.source).toBe('manual');
    expect(new Date(n.createdAt).toString()).not.toBe('Invalid Date');
  });

  test('ist in einen E-Mail-Payload überführbar (Subject trägt den Titel)', () => {
    const { subject } = buildEmailPayload(buildTestNotification());
    expect(subject).toMatch(/Test-Benachrichtigung/);
  });
});

// ── buildSlackPayload ────────────────────────────────────────────────────────

describe('buildSlackPayload()', () => {
  const notification = {
    severity: 'critical',
    title:    'Ransomware erkannt',
    body:     'Host 10.99.99.20 betroffen',
    source:   'wazuh',
    link:     '/tickets/INC000042',
    createdAt: '2026-06-15T12:00:00.000Z',
  };

  test('gibt ein Objekt mit text-Feld zurück', () => {
    const result = buildSlackPayload(notification);
    expect(result).toHaveProperty('text');
    expect(typeof result.text).toBe('string');
  });

  test('text enthält Severity (case-insensitive)', () => {
    const result = buildSlackPayload(notification);
    expect(result.text.toLowerCase()).toContain('critical');
  });

  test('text enthält Titel', () => {
    const result = buildSlackPayload(notification);
    expect(result.text).toContain('Ransomware erkannt');
  });

  test('text enthält Body', () => {
    const result = buildSlackPayload(notification);
    expect(result.text).toContain('Host 10.99.99.20 betroffen');
  });

  test('gibt kein Secret / keine URL zurück', () => {
    const result = buildSlackPayload(notification);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/https?:\/\//);    // kein http-Link
    expect(str).not.toMatch(/webhook/i);       // kein "webhook" im Output
  });

  test('funktioniert auch ohne body und link', () => {
    const minimal = { severity: 'info', title: 'Test', source: 'system', createdAt: '2026-01-01T00:00:00.000Z' };
    const result = buildSlackPayload(minimal);
    expect(result.text).toContain('Test');
  });
});

// ── buildWebhookPayload ──────────────────────────────────────────────────────

describe('buildWebhookPayload()', () => {
  const notification = {
    severity:  'high',
    title:     'Brute-Force-Angriff',
    body:      '500 Login-Versuche in 60s',
    source:    'wazuh',
    link:      '/tickets/INC000007',
    createdAt: '2026-06-15T08:30:00.000Z',
  };

  test('gibt severity zurück', () => {
    expect(buildWebhookPayload(notification).severity).toBe('high');
  });

  test('gibt title zurück', () => {
    expect(buildWebhookPayload(notification).title).toBe('Brute-Force-Angriff');
  });

  test('gibt body zurück', () => {
    expect(buildWebhookPayload(notification).body).toBe('500 Login-Versuche in 60s');
  });

  test('gibt source zurück', () => {
    expect(buildWebhookPayload(notification).source).toBe('wazuh');
  });

  test('gibt createdAt zurück', () => {
    expect(buildWebhookPayload(notification).createdAt).toBe('2026-06-15T08:30:00.000Z');
  });

  test('gibt link zurück wenn vorhanden', () => {
    expect(buildWebhookPayload(notification).link).toBe('/tickets/INC000007');
  });

  test('link fehlt wenn nicht übergeben', () => {
    const minimal = { severity: 'info', title: 'T', source: 's', createdAt: '2026-01-01T00:00:00.000Z' };
    const result = buildWebhookPayload(minimal);
    expect(result.link).toBeUndefined();
  });

  test('enthält KEINE Webhook-URL / kein Secret', () => {
    const result = buildWebhookPayload(notification);
    const str = JSON.stringify(result);
    expect(str).not.toMatch(/https?:\/\//);
    expect(str).not.toMatch(/webhook/i);
    expect(str).not.toMatch(/secret/i);
    expect(str).not.toMatch(/token/i);
  });
});

// ── deliverOutbound ──────────────────────────────────────────────────────────

describe('deliverOutbound()', () => {
  const notification = {
    severity: 'critical',
    title:    'Test',
    body:     'Body',
    source:   'ticket',
    createdAt: '2026-06-15T00:00:00.000Z',
  };

  // ── Inert-by-default: immer skipped wenn outboundEnabled=false ────────────

  test('gibt { skipped: "disabled" } zurück wenn outboundEnabled=false', async () => {
    const httpPost = jest.fn();
    const config = { outboundEnabled: false, slackWebhookUrl: 'https://hook.slack.com/T1', genericWebhookUrl: '' };

    const result = await deliverOutbound(notification, { httpPost, config });

    expect(result).toEqual({ skipped: 'disabled' });
    expect(httpPost).not.toHaveBeenCalled();
  });

  test('gibt { skipped: "disabled" } zurück wenn outboundEnabled fehlt (falsy)', async () => {
    const httpPost = jest.fn();
    const config = { outboundEnabled: undefined, slackWebhookUrl: 'https://hook.slack.com/T1', genericWebhookUrl: '' };

    const result = await deliverOutbound(notification, { httpPost, config });

    expect(result).toEqual({ skipped: 'disabled' });
    expect(httpPost).not.toHaveBeenCalled();
  });

  test('gibt { skipped: "no_targets" } zurück wenn enabled aber keine URL konfiguriert', async () => {
    const httpPost = jest.fn();
    const config = { outboundEnabled: true, slackWebhookUrl: '', genericWebhookUrl: '' };

    const result = await deliverOutbound(notification, { httpPost, config });

    expect(result).toEqual({ skipped: 'no_targets' });
    expect(httpPost).not.toHaveBeenCalled();
  });

  // ── Postet wenn enabled + URL konfiguriert ─────────────────────────────────

  test('postet an slackWebhookUrl wenn konfiguriert', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, slackWebhookUrl: 'https://hook.slack.com/T1', genericWebhookUrl: '' };

    await deliverOutbound(notification, { httpPost, config });

    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, body] = httpPost.mock.calls[0];
    expect(url).toBe('https://hook.slack.com/T1');
    expect(body).toHaveProperty('text'); // Slack-Format
  });

  test('postet an genericWebhookUrl wenn konfiguriert', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, slackWebhookUrl: '', genericWebhookUrl: 'https://siem.corp/hook' };

    await deliverOutbound(notification, { httpPost, config });

    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, body] = httpPost.mock.calls[0];
    expect(url).toBe('https://siem.corp/hook');
    expect(body).toHaveProperty('severity'); // Webhook-Format
  });

  test('postet an beide URLs wenn beide konfiguriert', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = {
      outboundEnabled:  true,
      slackWebhookUrl:  'https://hook.slack.com/T1',
      genericWebhookUrl: 'https://siem.corp/hook',
    };

    await deliverOutbound(notification, { httpPost, config });

    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  // ── Best-effort: wirft NIE, auch wenn httpPost fehlschlägt ────────────────

  test('wirft NICHT wenn httpPost eine Exception wirft', async () => {
    const httpPost = jest.fn().mockRejectedValue(new Error('Timeout'));
    const config = { outboundEnabled: true, slackWebhookUrl: 'https://hook.slack.com/T1', genericWebhookUrl: '' };

    await expect(deliverOutbound(notification, { httpPost, config })).resolves.not.toThrow();
  });

  test('wirft NICHT wenn httpPost für Slack fehlschlägt aber Webhook-Post okay', async () => {
    const httpPost = jest.fn()
      .mockRejectedValueOnce(new Error('Slack down'))
      .mockResolvedValueOnce({ status: 200 });
    const config = {
      outboundEnabled:  true,
      slackWebhookUrl:  'https://hook.slack.com/T1',
      genericWebhookUrl: 'https://siem.corp/hook',
    };

    await expect(deliverOutbound(notification, { httpPost, config })).resolves.not.toThrow();
    // Zweiter POST (generisch) muss trotzdem ausgeführt worden sein
    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  // ── Ergebnis enthält KEINE URL / kein Secret ──────────────────────────────

  test('Ergebnis-Objekt enthält keine Webhook-URL', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, slackWebhookUrl: 'https://hook.slack.com/T1', genericWebhookUrl: '' };

    const result = await deliverOutbound(notification, { httpPost, config });
    const str = JSON.stringify(result);

    expect(str).not.toContain('https://hook.slack.com/T1');
    expect(str).not.toMatch(/webhook/i);
  });
});

// ── buildTeamsPayload ────────────────────────────────────────────────────────

describe('buildTeamsPayload()', () => {
  const notification = {
    severity: 'critical', title: 'Ransomware erkannt', body: 'Host betroffen',
    source: 'wazuh', createdAt: '2026-06-20T08:00:00.000Z',
  };

  test('erzeugt eine MessageCard mit Titel, Schweregrad-Farbe und Fakten', () => {
    const card = buildTeamsPayload(notification);
    expect(card['@type']).toBe('MessageCard');
    expect(card.title).toBe('[CRITICAL] Ransomware erkannt');
    expect(card.themeColor).toBe('D32F2F'); // critical
    expect(card.sections[0].text).toBe('Host betroffen');
    const factNames = card.sections[0].facts.map((f) => f.name);
    expect(factNames).toEqual(expect.arrayContaining(['Schweregrad', 'Quelle', 'Zeit']));
  });

  test('Default-Farbe (info) bei unbekanntem Schweregrad; keine action mit relativem Link', () => {
    const card = buildTeamsPayload({ title: 'X', severity: 'weird', link: '/tickets/1' });
    expect(card.themeColor).toBe('1976D2'); // info-Fallback
    expect(card.potentialAction).toBeUndefined(); // kein invalider relativer URI
  });
});

// ── deliverOutbound: Teams-Kanal ─────────────────────────────────────────────

describe('deliverOutbound() — Teams', () => {
  const notification = { severity: 'high', title: 'C2-Beacon', source: 'crowdsec', createdAt: '2026-06-20T08:00:00.000Z' };

  test('postet an teamsWebhookUrl wenn konfiguriert', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, teamsWebhookUrl: 'https://outlook.office.com/webhook/T1' };
    const result = await deliverOutbound(notification, { httpPost, config });
    expect(result.sent).toContain('teams');
    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0][1]['@type']).toBe('MessageCard');
  });

  test('alle drei Kanäle parallel angesprochen', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, slackWebhookUrl: 'https://s', genericWebhookUrl: 'https://w', teamsWebhookUrl: 'https://t' };
    const result = await deliverOutbound(notification, { httpPost, config });
    expect(result.sent).toEqual(expect.arrayContaining(['slack', 'webhook', 'teams']));
    expect(httpPost).toHaveBeenCalledTimes(3);
  });

  test('Ergebnis enthält keine Teams-URL (nur Channel-ID)', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const config = { outboundEnabled: true, teamsWebhookUrl: 'https://outlook.office.com/webhook/SECRET' };
    const result = await deliverOutbound(notification, { httpPost, config });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

// ── buildEmailPayload ────────────────────────────────────────────────────────

describe('buildEmailPayload()', () => {
  const notification = {
    severity: 'critical', title: 'Ransomware erkannt', body: 'Host 10.99.99.20 betroffen',
    source: 'wazuh', createdAt: '2026-06-20T08:00:00.000Z',
  };

  test('gibt subject und text (Strings) zurück', () => {
    const result = buildEmailPayload(notification);
    expect(typeof result.subject).toBe('string');
    expect(typeof result.text).toBe('string');
  });

  test('subject enthält Severity (uppercase) und Titel', () => {
    const result = buildEmailPayload(notification);
    expect(result.subject).toContain('CRITICAL');
    expect(result.subject).toContain('Ransomware erkannt');
  });

  test('text enthält Body und Quelle', () => {
    const result = buildEmailPayload(notification);
    expect(result.text).toContain('Host 10.99.99.20 betroffen');
    expect(result.text).toContain('wazuh');
  });

  test('funktioniert minimal (nur severity + title)', () => {
    const result = buildEmailPayload({ severity: 'info', title: 'Test' });
    expect(result.subject).toContain('Test');
    expect(typeof result.text).toBe('string');
  });

  test('enthält keine SMTP-Daten / kein Secret', () => {
    const str = JSON.stringify(buildEmailPayload(notification));
    expect(str).not.toMatch(/smtp/i);
    expect(str).not.toMatch(/secret/i);
    expect(str).not.toMatch(/token/i);
  });
});

// ── deliverOutbound: E-Mail-Kanal ────────────────────────────────────────────

describe('deliverOutbound() — E-Mail', () => {
  const notification = { severity: 'high', title: 'C2-Beacon', source: 'crowdsec', createdAt: '2026-06-20T08:00:00.000Z' };
  const emailCfg = {
    host: 'smtp.corp.local', port: 587, secure: false,
    user: 'soc@corp', pass: 'SECRETPASS', from: 'soc@corp', to: 'team@corp',
  };

  test('sendet E-Mail wenn host + to konfiguriert', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '1' });
    const config = { outboundEnabled: true, email: emailCfg };
    const result = await deliverOutbound(notification, { sendMail, config });
    expect(result.sent).toContain('email');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const payload = sendMail.mock.calls[0][1];
    expect(payload).toHaveProperty('subject');
    expect(payload).toHaveProperty('text');
  });

  test('sendet NICHT wenn host fehlt', async () => {
    const sendMail = jest.fn();
    const config = { outboundEnabled: true, email: { ...emailCfg, host: '' } };
    const result = await deliverOutbound(notification, { sendMail, config });
    expect(sendMail).not.toHaveBeenCalled();
    expect(result.sent || []).not.toContain('email');
  });

  test('sendet NICHT wenn to fehlt', async () => {
    const sendMail = jest.fn();
    const config = { outboundEnabled: true, email: { ...emailCfg, to: '' } };
    await deliverOutbound(notification, { sendMail, config });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('Gate disabled: kein Versand wenn outboundEnabled=false', async () => {
    const sendMail = jest.fn();
    const config = { outboundEnabled: false, email: emailCfg };
    const result = await deliverOutbound(notification, { sendMail, config });
    expect(result).toEqual({ skipped: 'disabled' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('wirft NICHT wenn sendMail fehlschlägt (best-effort)', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const config = { outboundEnabled: true, email: emailCfg };
    await expect(deliverOutbound(notification, { sendMail, config })).resolves.not.toThrow();
  });

  test('Ergebnis enthält kein SMTP-Passwort (nur Channel-ID)', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const config = { outboundEnabled: true, email: emailCfg };
    const result = await deliverOutbound(notification, { sendMail, config });
    expect(JSON.stringify(result)).not.toContain('SECRETPASS');
  });

  test('E-Mail neben Webhook — beide Kanäle angesprochen', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const sendMail = jest.fn().mockResolvedValue({});
    const config = { outboundEnabled: true, slackWebhookUrl: 'https://s', email: emailCfg };
    const result = await deliverOutbound(notification, { httpPost, sendMail, config });
    expect(result.sent).toEqual(expect.arrayContaining(['slack', 'email']));
    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
