// Reine Client-Validierung für die Passwortänderung (Backend ist die echte Schranke).

import i18n from '../../i18n';

export const MIN_PASSWORD = 8;

export function validatePasswordChange(current: string, next: string, confirm: string): string | null {
  if (!current || !next) return i18n.t('app.pleaseEnterYourCurrentNew');
  if (next.length < MIN_PASSWORD) return i18n.t('app.newPasswordMinLength', { count: MIN_PASSWORD });
  if (next !== confirm) return i18n.t('app.newPasswordsDoNotMatch');
  if (next === current) return i18n.t('app.newPasswordMustDifferFrom');
  return null;
}
