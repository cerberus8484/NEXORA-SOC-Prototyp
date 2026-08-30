import { describe, test, expect } from 'vitest';
import {
  webhookSourceLabel, webhookOriginLabel, webhookOriginTone, generateWebhookSecret,
  type MaskedWebhookSecret,
} from './webhookSecretsModel';

describe('webhookSourceLabel', () => {
  test('bekannte Quellen bekommen sprechende Labels, unbekannte fallen auf den Key zurück', () => {
    expect(webhookSourceLabel('wazuh')).toMatch(/Wazuh/);
    expect(webhookSourceLabel('generic')).toMatch(/Fallback/);
    expect(webhookSourceLabel('xyz')).toBe('xyz');
  });
});

describe('webhookOriginLabel / -Tone', () => {
  test('ehrliche Herkunfts-Labels + passende Töne', () => {
    expect(webhookOriginLabel('db')).toMatch(/DB/);
    expect(webhookOriginLabel('env')).toMatch(/Systemwert/);
    expect(webhookOriginLabel('none')).toMatch(/generic/);
    const t = (origin: MaskedWebhookSecret['origin']): MaskedWebhookSecret => ({ source: 's', set: origin !== 'none', origin });
    expect(webhookOriginTone(t('db'))).toBe('success');
    expect(webhookOriginTone(t('env'))).toBe('accent');
    expect(webhookOriginTone(t('none'))).toBe('muted');
  });
});

describe('generateWebhookSecret', () => {
  test('liefert 64 Hex-Zeichen und ist bei Aufrufen verschieden', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
