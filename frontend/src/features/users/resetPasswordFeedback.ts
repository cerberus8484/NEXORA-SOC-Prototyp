// Reine Logik für den Admin-Passwort-Reset (POST /users/:id/reset-password).
// UI-frei und damit testbar — übersetzt Server-Antwort/Fehler in Anzeige-Zustand.

import i18n from '../../i18n';

export interface ResetPasswordSuccess {
  ok: true;
  tempPassword: string;
  warning: string;
}

export interface ResetPasswordError {
  ok: false;
  message: string;
}

export type ResetPasswordResult = ResetPasswordSuccess | ResetPasswordError;

// Einmalig anzeigen, sicher übermitteln — bewusst als Konstante, kein Magic-String im JSX.
export const RESET_PASSWORD_WARNING =
  i18n.t('ui.temporaryPasswordShownOnlyOnce');

/**
 * Wandelt die Server-Antwort in ein Anzeige-Ergebnis um.
 * Erwartet { data: { tempPassword: string } }. Fehlt das Passwort, ist das ein Fehler
 * (kein stiller Erfolg ohne Inhalt).
 */
export function resetPasswordResult(res: { data?: { tempPassword?: unknown } } | null | undefined): ResetPasswordResult {
  const temp = res?.data?.tempPassword;
  if (typeof temp === 'string' && temp.length > 0) {
    return { ok: true, tempPassword: temp, warning: RESET_PASSWORD_WARNING };
  }
  return { ok: false, message: i18n.t('ui.responseWithoutTemporaryPasswordReset') };
}

/** Übersetzt einen geworfenen Fehler (Netzwerk/HTTP) in eine Fehler-Meldung. */
export function resetPasswordErrorMessage(err: unknown): string {
  const base = err instanceof Error ? err.message : i18n.t('common.unknownError');
  return i18n.t('users.passwordResetFailedWith', { reason: base });
}
