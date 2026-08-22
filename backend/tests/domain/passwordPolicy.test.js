'use strict';

// TDD RED-Phase: passwordPolicy.js — reiner Validator ohne externe Deps.
// validatePassword(pw, { minLength, complexity }) → { ok, errors }
//
// Komplexitätsstufen:
//   low    = nur Mindestlänge
//   medium = Länge + min. 1 Buchstabe + min. 1 Ziffer
//   high   = Länge + Groß + Klein + Ziffer + Sonderzeichen

const { validatePassword } = require('../../src/domain/passwordPolicy');

describe('validatePassword — Basis-Längen-Check', () => {
  test('zu kurzes Passwort → ok=false, Fehler im Array', () => {
    const result = validatePassword('abc', { minLength: 8, complexity: 'low' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/mindestens 8/i);
  });

  test('genau an der Grenze → ok=true (low complexity)', () => {
    const result = validatePassword('abcdefgh', { minLength: 8, complexity: 'low' });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('Leerzeichen-Passwort trifft Länge (low, 8+)', () => {
    const result = validatePassword('        ', { minLength: 8, complexity: 'low' });
    expect(result.ok).toBe(true); // low prüft nur Länge
  });

  test('minLength=12 → zu kurz bei 11 Zeichen', () => {
    const result = validatePassword('12345678901', { minLength: 12, complexity: 'low' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/mindestens 12/i);
  });

  test('minLength=12 → ok bei 12 Zeichen (low)', () => {
    const result = validatePassword('123456789012', { minLength: 12, complexity: 'low' });
    expect(result.ok).toBe(true);
  });
});

describe('validatePassword — complexity=medium', () => {
  test('nur Buchstaben, kein Zahl → Fehler', () => {
    const result = validatePassword('abcdefgh', { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /ziffer|zahl/i.test(e))).toBe(true);
  });

  test('nur Ziffern, kein Buchstabe → Fehler', () => {
    const result = validatePassword('12345678', { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /buchstabe/i.test(e))).toBe(true);
  });

  test('Buchstabe + Ziffer → ok (medium)', () => {
    const result = validatePassword('Test1234', { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('zu kurz + fehlt Ziffer → mehrere Fehler', () => {
    const result = validatePassword('abc', { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validatePassword — complexity=high', () => {
  test('fehlt Großbuchstabe → Fehler', () => {
    const result = validatePassword('test1234!', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /groß/i.test(e))).toBe(true);
  });

  test('fehlt Kleinbuchstabe → Fehler', () => {
    const result = validatePassword('TEST1234!', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /klein/i.test(e))).toBe(true);
  });

  test('fehlt Sonderzeichen → Fehler', () => {
    const result = validatePassword('TestPass1', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /sonderzeichen/i.test(e))).toBe(true);
  });

  test('fehlt Ziffer → Fehler (high)', () => {
    const result = validatePassword('TestPass!', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /ziffer|zahl/i.test(e))).toBe(true);
  });

  test('alle Anforderungen erfüllt → ok=true', () => {
    const result = validatePassword('TestPass1!', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('Unicode-Sonderzeichen werden als Sonderzeichen gewertet', () => {
    const result = validatePassword('TestPass1€', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(true);
  });

  test('alle Anforderungen fehlen → 5 Fehler', () => {
    const result = validatePassword('a', { minLength: 8, complexity: 'high' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('validatePassword — Grenzfälle', () => {
  test('leeres Passwort → ok=false, Fehler', () => {
    const result = validatePassword('', { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('null-Passwort → ok=false, wirft nicht', () => {
    const result = validatePassword(null, { minLength: 8, complexity: 'medium' });
    expect(result.ok).toBe(false);
  });

  test('undefined-Passwort → ok=false, wirft nicht', () => {
    const result = validatePassword(undefined, { minLength: 8, complexity: 'low' });
    expect(result.ok).toBe(false);
  });

  test('fehlende complexity → fällt auf medium zurück', () => {
    const result = validatePassword('TestPass1', { minLength: 8 });
    // medium: Buchstabe + Ziffer — sollte ok sein
    expect(result.ok).toBe(true);
  });

  test('fehlender minLength → fällt auf 8 zurück', () => {
    const result = validatePassword('Test1', { complexity: 'medium' });
    expect(result.ok).toBe(false); // zu kurz (< 8 default)
  });

  test('minLength 128 — sehr lange Passwörter werden akzeptiert', () => {
    const pw = 'Aa1!'.repeat(32); // 128 Zeichen
    const result = validatePassword(pw, { minLength: 128, complexity: 'high' });
    expect(result.ok).toBe(true);
  });

  test('special chars: alle gängigen ASCII Sonderzeichen für high', () => {
    const specials = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '+', '='];
    for (const s of specials) {
      const result = validatePassword(`TestPass1${s}`, { minLength: 8, complexity: 'high' });
      expect(result.ok).toBe(true);
    }
  });
});
