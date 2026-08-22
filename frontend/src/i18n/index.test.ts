import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n, { DEFAULT_LANGUAGE, changeLanguage } from './index';

describe('i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('uses English as the default language', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(i18n.t('auth.signIn')).toBe('Sign in');
  });

  it('applies an explicit language change to the document', async () => {
    await changeLanguage('de');

    expect(i18n.language).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(i18n.t('auth.signIn')).toBe('Anmelden');
  });
});
