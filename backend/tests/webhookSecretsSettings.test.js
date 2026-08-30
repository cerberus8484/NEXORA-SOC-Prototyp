'use strict';

// webhookSecretsSettings — Inbound-Webhook-HMAC-Secrets je Quelle aus der DB verwalten,
// ENV bleibt Fallback (DB > ENV, mit generic-Fallback). AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  WEBHOOK_SECRETS_KEY, WEBHOOK_SOURCES,
  resolveWebhookSecret, saveWebhookSecret, maskedWebhookSecrets,
} = require('../src/services/webhookSecretsSettings');

let repo;
beforeEach(() => { repo = new InMemorySettingsRepository(); });

describe('resolveWebhookSecret — DB > ENV, generic-Fallback', () => {
  test('DB[source] gewinnt über alles', async () => {
    await saveWebhookSecret(repo, 'wazuh', 'db-wazuh');
    const env = { WEBHOOK_SECRET_WAZUH: 'env-wazuh', WEBHOOK_SECRET_GENERIC: 'env-gen' };
    expect(await resolveWebhookSecret(repo, 'wazuh', env)).toBe('db-wazuh');
  });

  test('ohne DB[source] → ENV[source]', async () => {
    expect(await resolveWebhookSecret(repo, 'qradar', { WEBHOOK_SECRET_QRADAR: 'env-q' })).toBe('env-q');
  });

  test('ohne source-Secret → DB[generic] > ENV[generic]', async () => {
    expect(await resolveWebhookSecret(repo, 'splunk', { WEBHOOK_SECRET_GENERIC: 'env-gen' })).toBe('env-gen');
    await saveWebhookSecret(repo, 'generic', 'db-gen');
    expect(await resolveWebhookSecret(repo, 'splunk', { WEBHOOK_SECRET_GENERIC: 'env-gen' })).toBe('db-gen');
  });

  test('nichts konfiguriert → null', async () => {
    expect(await resolveWebhookSecret(repo, 'wazuh', {})).toBeNull();
  });
});

describe('saveWebhookSecret', () => {
  test('verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveWebhookSecret(repo, 'wazuh', 'super-geheim');
    const stored = await repo.get(WEBHOOK_SECRETS_KEY);
    expect(isEncrypted(stored.wazuh)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.wazuh)).toBe('super-geheim');
  });

  test('leeres Secret löscht die Quelle (→ Fallback)', async () => {
    await saveWebhookSecret(repo, 'wazuh', 'x');
    await saveWebhookSecret(repo, 'wazuh', '');
    expect((await repo.get(WEBHOOK_SECRETS_KEY)).wazuh).toBeUndefined();
  });

  test('unbekannte Quelle → WEBHOOK_SOURCE_UNKNOWN', async () => {
    await expect(saveWebhookSecret(repo, 'nope', 'x')).rejects.toMatchObject({ code: 'WEBHOOK_SOURCE_UNKNOWN' });
  });
});

describe('maskedWebhookSecrets', () => {
  test('gibt NIE ein Secret heraus — je Quelle set + origin', async () => {
    await saveWebhookSecret(repo, 'wazuh', 'geheim');
    const masked = await maskedWebhookSecrets(repo, { WEBHOOK_SECRET_QRADAR: 'env-q' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
    expect(masked.find((m) => m.source === 'wazuh')).toEqual({ source: 'wazuh', set: true, origin: 'db' });
    expect(masked.find((m) => m.source === 'qradar')).toEqual({ source: 'qradar', set: true, origin: 'env' });
    expect(masked.find((m) => m.source === 'splunk')).toEqual({ source: 'splunk', set: false, origin: 'none' });
    expect(masked.map((m) => m.source)).toEqual([...WEBHOOK_SOURCES]);
  });
});
