'use strict';

// notificationSettings — Outbound-Kanäle (SMTP + Webhooks + Master-Schalter) aus
// der DB verwalten, ENV bleibt Fallback (DB > ENV, Layer-2-Konvention).
//
// Sichert:
//   - resolve: DB-Sektion gewinnt, sonst ENV; Secrets entschlüsselt,
//   - save: SMTP-Passwort + Webhook-URLs AES-256-GCM; leeres Secret = unverändert;
//           leerer SMTP-Host = Email-Sektion löschen (→ ENV),
//   - masked: NIE ein Passwort/eine URL; nur *Set-Boolean + Quelle.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted } = require('../src/config/secretsCrypto');
const config = require('../src/config');
const {
  NOTIFICATION_SETTINGS_KEY,
  resolveNotificationConfig,
  saveNotificationSettings,
  maskedNotificationSettings,
} = require('../src/services/notificationSettings');

let repo;
const envBackup = {};

beforeEach(() => {
  repo = new InMemorySettingsRepository();
  envBackup.notifications = JSON.parse(JSON.stringify(config.notifications));
  // Definierter ENV-Stand.
  config.notifications.outboundEnabled = false;
  config.notifications.slackWebhookUrl = 'https://hooks.example/env-slack';
  config.notifications.genericWebhookUrl = '';
  config.notifications.teamsWebhookUrl = '';
  config.notifications.email = { host: 'env-smtp', port: 587, secure: false, user: 'env-user', pass: 'env-pass', from: 'env@x', to: 'soc@x' };
});

afterEach(() => {
  config.notifications.outboundEnabled = envBackup.notifications.outboundEnabled;
  config.notifications.slackWebhookUrl = envBackup.notifications.slackWebhookUrl;
  config.notifications.genericWebhookUrl = envBackup.notifications.genericWebhookUrl;
  config.notifications.teamsWebhookUrl = envBackup.notifications.teamsWebhookUrl;
  config.notifications.email = envBackup.notifications.email;
});

describe('resolveNotificationConfig', () => {
  test('ohne DB-Eintrag → ENV-Werte', async () => {
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.outboundEnabled).toBe(false);
    expect(cfg.email).toMatchObject({ host: 'env-smtp', user: 'env-user', pass: 'env-pass', to: 'soc@x' });
    expect(cfg.slackWebhookUrl).toBe('https://hooks.example/env-slack');
  });

  test('DB-Email-Sektion gewinnt über ENV (Passwort entschlüsselt)', async () => {
    await saveNotificationSettings(repo, { email: { host: 'db-smtp', port: 465, secure: true, user: 'db-user', pass: 'db-pass', from: 'a@b', to: 'x@y' } });
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.email).toMatchObject({ host: 'db-smtp', port: 465, secure: true, user: 'db-user', pass: 'db-pass' });
  });

  test('DB-Webhook-URL + outboundEnabled gewinnen', async () => {
    await saveNotificationSettings(repo, { outboundEnabled: true, slackWebhookUrl: 'https://hooks.example/db-slack' });
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.outboundEnabled).toBe(true);
    expect(cfg.slackWebhookUrl).toBe('https://hooks.example/db-slack');
  });
});

describe('saveNotificationSettings', () => {
  test('SMTP-Passwort + Webhook-URL liegen verschlüsselt in der DB (enc:v1:)', async () => {
    await saveNotificationSettings(repo, {
      email: { host: 'db-smtp', port: 587, secure: false, user: 'u', pass: 'smtp-secret', from: 'a', to: 'b' },
      slackWebhookUrl: 'https://hooks.example/secret-token',
    });
    const stored = await repo.get(NOTIFICATION_SETTINGS_KEY);
    expect(isEncrypted(stored.email.pass)).toBe(true);
    expect(isEncrypted(stored.slackWebhookUrl)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('smtp-secret');
    expect(JSON.stringify(stored)).not.toContain('secret-token');
  });

  test('leeres SMTP-Passwort behält das gespeicherte', async () => {
    await saveNotificationSettings(repo, { email: { host: 'db-smtp', port: 587, secure: false, user: 'u', pass: 'orig', from: 'a', to: 'b' } });
    await saveNotificationSettings(repo, { email: { host: 'db-smtp', port: 587, secure: false, user: 'u2', pass: '', from: 'a', to: 'b' } });
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.email.user).toBe('u2');
    expect(cfg.email.pass).toBe('orig');
  });

  test('leerer SMTP-Host löscht die Email-Sektion → Auflösung fällt auf ENV', async () => {
    await saveNotificationSettings(repo, { email: { host: 'db-smtp', port: 587, secure: false, user: 'u', pass: 'p', from: 'a', to: 'b' } });
    await saveNotificationSettings(repo, { email: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' } });
    const stored = await repo.get(NOTIFICATION_SETTINGS_KEY);
    expect(stored.email).toBeUndefined();
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.email.host).toBe('env-smtp');
  });

  test('leere Webhook-URL im Patch behält die gespeicherte (Secret, kein Klartext-Round-Trip)', async () => {
    await saveNotificationSettings(repo, { teamsWebhookUrl: 'https://hooks.example/teams-token' });
    await saveNotificationSettings(repo, { teamsWebhookUrl: '' });
    const cfg = await resolveNotificationConfig(repo);
    expect(cfg.teamsWebhookUrl).toBe('https://hooks.example/teams-token');
  });
});

describe('maskedNotificationSettings', () => {
  test('gibt NIE Passwörter/URLs heraus — nur *Set-Booleans + Quelle', async () => {
    await saveNotificationSettings(repo, {
      outboundEnabled: true,
      email: { host: 'db-smtp', port: 465, secure: true, user: 'u', pass: 'geheim', from: 'a@b', to: 'x@y' },
      slackWebhookUrl: 'https://hooks.example/secret',
    });
    const masked = await maskedNotificationSettings(repo);
    expect(masked.outboundEnabled).toBe(true);
    expect(masked.email).toEqual({ host: 'db-smtp', port: 465, secure: true, user: 'u', from: 'a@b', to: 'x@y', passwordSet: true, source: 'db' });
    const slack = masked.channels.find((c) => c.id === 'slack');
    expect(slack).toEqual({ id: 'slack', urlSet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
    expect(JSON.stringify(masked)).not.toContain('secret');
  });

  test('ohne DB → Email-Quelle env (aus ENV-Config), Slack env', async () => {
    const masked = await maskedNotificationSettings(repo);
    expect(masked.email.source).toBe('env');
    expect(masked.channels.find((c) => c.id === 'slack')).toEqual({ id: 'slack', urlSet: true, source: 'env' });
    expect(masked.channels.find((c) => c.id === 'webhook')).toEqual({ id: 'webhook', urlSet: false, source: 'none' });
  });
});
