import { describe, test, expect } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguageTag,
  resolveInitialLanguage,
} from './language';

describe('isSupportedLanguage', () => {
  test('erkennt die unterstützten Sprachen', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(true);
  });

  test('lehnt alles andere ab — auch leere und falsch getypte Werte', () => {
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(42)).toBe(false);
  });
});

describe('normalizeLanguageTag', () => {
  test('reduziert Regions-Tags auf die Basissprache', () => {
    expect(normalizeLanguageTag('en-US')).toBe('en');
    expect(normalizeLanguageTag('de-AT')).toBe('de');
  });

  test('ist unabhängig von Groß-/Kleinschreibung', () => {
    expect(normalizeLanguageTag('DE')).toBe('de');
    expect(normalizeLanguageTag('En-Gb')).toBe('en');
  });

  test('gibt null für nicht unterstützte oder unbrauchbare Tags', () => {
    expect(normalizeLanguageTag('fr-FR')).toBeNull();
    expect(normalizeLanguageTag('')).toBeNull();
    expect(normalizeLanguageTag(undefined)).toBeNull();
  });
});

describe('resolveInitialLanguage', () => {
  test('gespeicherte Wahl des Nutzers gewinnt', () => {
    expect(resolveInitialLanguage({ stored: 'de' })).toBe('de');
    expect(resolveInitialLanguage({ stored: 'en' })).toBe('en');
  });

  test('akzeptiert auch ein Regions-Tag als gespeicherte Wahl', () => {
    expect(resolveInitialLanguage({ stored: 'de-AT' })).toBe('de');
  });

  test('ohne Wahl steht Nexora auf Englisch', () => {
    // Bewusst unabhaengig von der Browsersprache: sonst bekaeme ein deutscher
    // Rechner nie das englische UI zu sehen und "Englisch als Standard" waere
    // eine Einstellung ohne Wirkung.
    expect(resolveInitialLanguage({ stored: null })).toBe(DEFAULT_LANGUAGE);
    expect(resolveInitialLanguage({})).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  test('ignoriert einen unbrauchbaren gespeicherten Wert, statt daran zu scheitern', () => {
    // localStorage kann von Hand oder aus einer aelteren Version alles enthalten.
    expect(resolveInitialLanguage({ stored: 'klingon' })).toBe(DEFAULT_LANGUAGE);
    expect(resolveInitialLanguage({ stored: '' })).toBe(DEFAULT_LANGUAGE);
  });

  test('SUPPORTED_LANGUAGES enthaelt genau die zwei ausgelieferten Kataloge', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'de']);
  });
});
