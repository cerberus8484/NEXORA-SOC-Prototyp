import { describe, test, expect } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import { restartResultMessage, restartErrorMessage } from './restartFeedback';
import type { RestartResult } from './servicesApi';

describe('restartResultMessage — ehrliche Erfolgsmeldung (kein Fake)', () => {
  test('bestätigter Neustart → Erfolg, als bestätigt markiert', () => {
    const res: RestartResult = { ok: true, restarted: true, confirmed: true };
    const msg = restartResultMessage(res);
    expect(msg.tone).toBe('success');
    expect(msg.text).toContain('bestätigt');
  });

  test('ausgelöst aber NICHT bestätigt → neutral/warnend, keine falsche Erfolgsbehauptung', () => {
    const res: RestartResult = { ok: true, restarted: true, confirmed: false };
    const msg = restartResultMessage(res);
    expect(msg.tone).toBe('warning');
    expect(msg.text.toLowerCase()).toContain('nicht bestätigt');
  });

  test('ok=false → als Fehler behandelt (kein Fake-Erfolg)', () => {
    const res: RestartResult = { ok: false, restarted: false, confirmed: false };
    const msg = restartResultMessage(res);
    expect(msg.tone).toBe('error');
  });
});

describe('restartErrorMessage — HTTP-Status auf ehrliche, spezifische Meldung mappen', () => {
  const mk = (status: number, code = 'ERROR') => new ApiError('x', status, code);

  test('403 → deaktiviert-Hinweis nennt WAZUH_MANAGER_RESTART_ENABLED', () => {
    const msg = restartErrorMessage(mk(403));
    expect(msg.tone).toBe('error');
    expect(msg.text).toContain('WAZUH_MANAGER_RESTART_ENABLED');
  });

  test('409 → Wazuh-API nicht konfiguriert', () => {
    const msg = restartErrorMessage(mk(409));
    expect(msg.text).toContain('nicht konfiguriert');
  });

  test('422 → invalide Konfiguration, Restart abgebrochen', () => {
    const msg = restartErrorMessage(mk(422));
    expect(msg.text.toLowerCase()).toContain('konfiguration');
    expect(msg.text.toLowerCase()).toContain('abgebrochen');
  });

  test('429 → Rate-Limit-Hinweis', () => {
    const msg = restartErrorMessage(mk(429));
    expect(msg.text.toLowerCase()).toContain('zu viele');
  });

  test('502/504 → generischer Fehlschlag ohne interne Details', () => {
    expect(restartErrorMessage(mk(502)).text.toLowerCase()).toContain('fehlgeschlagen');
    expect(restartErrorMessage(mk(504)).text.toLowerCase()).toContain('fehlgeschlagen');
  });

  test('unbekannter Fehler (kein ApiError) → generische Fehlermeldung, kein Crash', () => {
    const msg = restartErrorMessage(new Error('boom'));
    expect(msg.tone).toBe('error');
    expect(msg.text.length).toBeGreaterThan(0);
  });

  test('leakt keine rohe Fehlermeldung nach außen', () => {
    const msg = restartErrorMessage(new ApiError('Bearer secret-token-leak', 502));
    expect(msg.text).not.toContain('secret-token-leak');
  });
});
