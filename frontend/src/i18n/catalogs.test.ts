import { describe, test, expect } from 'vitest';
import i18n, { resources } from './index';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../lib/language';
import en from './locales/en.json';
import de from './locales/de.json';

/** Alle Blattschlüssel in Punktnotation ('login.signIn'), rekursiv und sortiert. */
function flatKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

/** Interpolationsplatzhalter eines Textes, z. B. '{{min}}'. */
function placeholders(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort();
}

function leafValues(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (obj === null || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([k, v]) => leafValues(v, prefix ? `${prefix}.${k}` : k));
}

describe('Übersetzungskataloge', () => {
  // Fehlt ein Schlüssel im deutschen Katalog, greift der Fallback und der Nutzer
  // sieht mitten im deutschen UI einen englischen Satz — ohne dass irgendetwas
  // kaputtgeht. Genau deshalb muss ein Test das aufdecken.
  test('englischer und deutscher Katalog haben identische Schlüssel', () => {
    expect(flatKeys(de)).toEqual(flatKeys(en));
  });

  test('kein Katalogeintrag ist leer', () => {
    for (const [lang, catalog] of [['en', en], ['de', de]] as const) {
      for (const [key, value] of leafValues(catalog)) {
        expect(value.trim(), `${lang}: ${key} ist leer`).not.toBe('');
      }
    }
  });

  test('Platzhalter stimmen zwischen den Sprachen überein', () => {
    // Ein in der Übersetzung vergessenes {{min}} würde sonst als Text ohne Zahl
    // erscheinen ("Code muss mindestens Zeichen haben").
    const enValues = new Map(leafValues(en));
    for (const [key, deValue] of leafValues(de)) {
      expect(placeholders(deValue), `Platzhalter weichen ab bei ${key}`)
        .toEqual(placeholders(enValues.get(key) ?? ''));
    }
  });

  test('für jede unterstützte Sprache existiert ein Katalog', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(Object.keys(resources)).toContain(lang);
    }
  });
});

describe('i18n-Laufzeit', () => {
  test('übersetzt nach Sprachwechsel in die jeweilige Sprache', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('login.signIn')).toBe('Sign in');

    await i18n.changeLanguage('de');
    expect(i18n.t('login.signIn')).toBe('Anmelden');
  });

  test('interpoliert Parameter statt den Platzhalter auszugeben', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('validation.mfaCodeTooShort', { min: 6 })).toBe('Code must be at least 6 characters');
  });

  test('fällt bei unbekannter Sprache auf Englisch zurück', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('login.signIn')).toBe('Sign in');
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });
});
