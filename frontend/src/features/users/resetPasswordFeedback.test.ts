import { describe, test, expect } from 'vitest';
import {
  resetPasswordResult,
  resetPasswordErrorMessage,
  RESET_PASSWORD_WARNING,
} from './resetPasswordFeedback';

describe('resetPasswordResult', () => {
  test('gültiges temp-Passwort → Erfolg mit Warnhinweis', () => {
    // Arrange
    const res = { data: { tempPassword: 'Xy7-aB9-q2' } };

    // Act
    const result = resetPasswordResult(res);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tempPassword).toBe('Xy7-aB9-q2');
      expect(result.warning).toBe(RESET_PASSWORD_WARNING);
    }
  });

  test('leeres temp-Passwort → Fehler statt stillem Erfolg', () => {
    const result = resetPasswordResult({ data: { tempPassword: '' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('ohne temporäres Passwort');
  });

  test('fehlendes data-Feld → Fehler', () => {
    const result = resetPasswordResult({});
    expect(result.ok).toBe(false);
  });

  test('null-Antwort → Fehler', () => {
    const result = resetPasswordResult(null);
    expect(result.ok).toBe(false);
  });

  test('tempPassword vom falschen Typ → Fehler', () => {
    const result = resetPasswordResult({ data: { tempPassword: 12345 } });
    expect(result.ok).toBe(false);
  });
});

describe('resetPasswordErrorMessage', () => {
  test('Error-Objekt wird in die Meldung übernommen', () => {
    const msg = resetPasswordErrorMessage(new Error('HTTP 403'));
    expect(msg).toContain('HTTP 403');
    expect(msg).toContain('fehlgeschlagen');
  });

  test('Nicht-Error-Wert → generische Meldung', () => {
    const msg = resetPasswordErrorMessage('boom');
    expect(msg).toContain('Unbekannter Fehler');
  });
});
