import { describe, expect, test } from 'vitest';
import {
  emptyOutboundForm,
  formFromMasked,
  buildNotifConfigPatch,
  notifSourceLabel,
  type OutboundForm,
} from './outboundConfigModel';
import type { NotifConfigMasked } from './notificationsApi';

const masked = (over: Partial<NotifConfigMasked> = {}): NotifConfigMasked => ({
  outboundEnabled: false,
  email: { host: 'mail.x', port: 587, secure: false, user: 'u', from: 'a@x', to: 'b@x', passwordSet: true, source: 'db' },
  channels: [
    { id: 'slack', urlSet: true, source: 'db' },
    { id: 'webhook', urlSet: false, source: 'none' },
    { id: 'teams', urlSet: false, source: 'none' },
  ],
  ...over,
});

describe('formFromMasked', () => {
  test('übernimmt Email-Felder, Passwort + Webhook-Secrets bleiben leer', () => {
    const f = formFromMasked(masked());
    expect(f.email).toMatchObject({ host: 'mail.x', port: 587, secure: false, user: 'u', from: 'a@x', to: 'b@x', pass: '' });
    expect(f.slackWebhookUrl).toBe('');
    expect(f.outboundEnabled).toBe(false);
  });
});

describe('buildNotifConfigPatch', () => {
  const base = (o: Partial<OutboundForm> = {}): OutboundForm => ({ ...emptyOutboundForm(), ...o });

  test('email immer enthalten; leeres Passwort bleibt leer (Server behält)', () => {
    const patch = buildNotifConfigPatch(base({ email: { host: 'h', port: 25, secure: true, user: 'u', pass: '', from: 'f', to: 't' } }));
    expect(patch.email).toEqual({ host: 'h', port: 25, secure: true, user: 'u', pass: '', from: 'f', to: 't' });
    expect(patch.outboundEnabled).toBe(false);
  });

  test('nur nicht-leere Webhook-Secrets landen im Patch', () => {
    const patch = buildNotifConfigPatch(base({ slackWebhookUrl: ' https://x ', teamsWebhookUrl: '' }));
    expect(patch.slackWebhookUrl).toBe('https://x');
    expect(patch).not.toHaveProperty('teamsWebhookUrl');
    expect(patch).not.toHaveProperty('genericWebhookUrl');
  });

  test('outboundEnabled wird übernommen', () => {
    expect(buildNotifConfigPatch(base({ outboundEnabled: true })).outboundEnabled).toBe(true);
  });
});

describe('notifSourceLabel', () => {
  test('ehrliche Herkunft', () => {
    expect(notifSourceLabel('db')).toMatch(/UI/);
    expect(notifSourceLabel('env')).toMatch(/Systemwert/);
    expect(notifSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
