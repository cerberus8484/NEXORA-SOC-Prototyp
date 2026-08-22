import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import de from './locales/de.json';

export type Language = 'en' | 'de';
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'nexora.language';

function initialLanguage(): Language {
  let stored: string | null = null;
  try {
    stored = window.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be unavailable in private browsing or test environments.
  }
  return stored === 'de' || stored === 'en' ? stored : DEFAULT_LANGUAGE;
}

function persistLanguage(language: Language): void {
  try {
    window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The active session remains translated even when persistence is unavailable.
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export function changeLanguage(language: Language): Promise<void> {
  const changed = i18n.changeLanguage(language);
  persistLanguage(language);
  document.documentElement.lang = language;
  return changed.then(() => undefined);
}

export default i18n;
