// i18next-Initialisierung.
//
// Die Kataloge werden statisch importiert statt per HTTP-Backend nachgeladen:
// Nexora läuft in air-gapped Umgebungen, und ein fehlender Netzabruf würde dort
// ein leeres UI erzeugen. Zwei Sprachen sind klein genug, um sie mitzuliefern.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, resolveInitialLanguage, readStoredLanguage, type Language } from '../lib/language';
import en from './locales/en.json';
import de from './locales/de.json';

export const resources = { en: { translation: en }, de: { translation: de } } as const;

/** Sprache für den ersten Render — Profil-Sprache wird später vom LanguageProvider nachgezogen. */
function initialLanguage(): Language {
  return resolveInitialLanguage({ stored: readStoredLanguage() });
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  // Fehlt ein Schlüssel im deutschen Katalog, erscheint der englische Text —
  // besser als ein roher Schlüssel wie "mfa.codeHint" im UI.
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React escapet selbst; doppeltes Escaping würde aus "&" ein "&amp;" machen.
    escapeValue: false,
  },
  // Ein einzelner Namensraum: Die Trennung läuft über Schlüssel-Präfixe
  // (login.*, mfa.*), was ohne Lazy-Loading einfacher zu überblicken ist.
  defaultNS: 'translation',
});

export default i18n;
