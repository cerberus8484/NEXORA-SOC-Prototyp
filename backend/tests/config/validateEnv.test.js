'use strict';

const { validateEnv } = require('../../src/config/validateEnv');

// Minimal gültige Prod-ENV (alle Pflicht-Secrets ok). Tests variieren nur AUDIT_IP_SALT.
function validProdEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    DB_HOST: 'postgres', DB_NAME: 'soc', DB_USER: 'soc_api', DB_PASSWORD: 'strong-prod-pw',
    CORS_ORIGINS: 'https://nexora.local',
    WEBHOOK_SECRET_GENERIC: 'a-real-webhook-secret',
    WAZUH_TLS_REJECT_UNAUTHORIZED: 'true',
    AUDIT_IP_SALT: 'a'.repeat(40),
    ...overrides,
  };
}

describe('validateEnv — AUDIT_IP_SALT Fail-fast (P0, DSGVO Art. 25)', () => {
  let origEnv, exitSpy;
  beforeEach(() => {
    origEnv = process.env;
    process.env = { ...validProdEnv() };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { process.env = origEnv; jest.restoreAllMocks(); });

  test('gültiger Salt (≥32) → kein Fail-fast', () => {
    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('AUDIT_IP_SALT ungesetzt → Fail-fast (exit 1)', () => {
    delete process.env.AUDIT_IP_SALT;
    expect(() => validateEnv()).toThrow('exit:1');
  });

  test('AUDIT_IP_SALT = bekannter Dev-Default → Fail-fast', () => {
    process.env.AUDIT_IP_SALT = 'dev-audit-ip-salt-change-in-production';
    expect(() => validateEnv()).toThrow('exit:1');
  });

  test('AUDIT_IP_SALT < 32 Zeichen → Fail-fast', () => {
    process.env.AUDIT_IP_SALT = 'tooshort';
    expect(() => validateEnv()).toThrow('exit:1');
  });

  test('NODE_ENV != production → keine Prüfung, kein exit', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUDIT_IP_SALT;
    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('CHANGE_ME-Platzhalter in einem Secret → Fail-fast (Fresh-Install ohne gen-env)', () => {
    // >32 Zeichen + ≠ Dev-Default → würde die anderen Prüfungen passieren.
    process.env.JWT_SECRET = 'CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_64';
    expect(() => validateEnv()).toThrow('exit:1');
  });

  test('Wazuh konfiguriert ohne TLS-Zertifikatprüfung → Fail-fast', () => {
    process.env.WAZUH_API_URL = 'https://wazuh.example.local:55000';
    process.env.WAZUH_TLS_REJECT_UNAUTHORIZED = 'false';

    expect(() => validateEnv()).toThrow('exit:1');
  });

  test('Wazuh nicht konfiguriert ohne TLS-Zertifikatprüfung → nur Warnung', () => {
    delete process.env.WAZUH_API_URL;
    delete process.env.WAZUH_INDEXER_URL;
    process.env.WAZUH_TLS_REJECT_UNAUTHORIZED = 'false';

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  test('QRadar konfiguriert mit explizit deaktivierter TLS-Pruefung -> Fail-fast', () => {
    process.env.QRADAR_BASE_URL = 'https://qradar.example.local';
    process.env.QRADAR_TLS_REJECT_UNAUTHORIZED = 'false';

    expect(() => validateEnv()).toThrow('exit:1');
  });
});
