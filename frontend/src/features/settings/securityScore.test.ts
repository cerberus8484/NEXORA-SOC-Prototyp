// TDD RED: Reine Logiktests für computeSecurityPosture.
// Kein Buffer, kein @types/node — no JSX, no DOM.

import { describe, test, expect } from 'vitest';
import {
  computeSecurityPosture,
  type SecurityPostureInput,
  type PasswordStrength,
  type SessionRating,
} from './securityScore';

// ── computeSecurityPosture: Passwort-Stärke ──────────────────────────────────

describe('computeSecurityPosture – Passwort-Stärke', () => {
  test('minLength ≥ 12 + Komplexität high → stark', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('stark');
  });

  test('minLength ≥ 12 + Komplexität medium → stark', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'medium', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('stark');
  });

  test('minLength ≥ 10 + Komplexität high → ok', () => {
    const p = computeSecurityPosture({ passwordMinLength: 10, passwordComplexity: 'high', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('ok');
  });

  test('minLength = 8 + Komplexität medium → ok', () => {
    const p = computeSecurityPosture({ passwordMinLength: 8, passwordComplexity: 'medium', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('ok');
  });

  test('minLength = 8 + Komplexität low → schwach', () => {
    const p = computeSecurityPosture({ passwordMinLength: 8, passwordComplexity: 'low', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('schwach');
  });

  test('minLength < 8 → schwach (unabhängig von Komplexität)', () => {
    const p = computeSecurityPosture({ passwordMinLength: 6, passwordComplexity: 'high', sessionMaxHours: 8 });
    expect(p.passwordStrength).toBe<PasswordStrength>('schwach');
  });
});

// ── computeSecurityPosture: Sitzungs-Rating ───────────────────────────────────

describe('computeSecurityPosture – Sitzungs-Rating', () => {
  test('sessionMaxHours ≤ 4 → streng', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 });
    expect(p.sessionRating).toBe<SessionRating>('streng');
  });

  test('sessionMaxHours ≤ 12 → ok', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 8 });
    expect(p.sessionRating).toBe<SessionRating>('ok');
  });

  test('sessionMaxHours = 12 → ok', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 12 });
    expect(p.sessionRating).toBe<SessionRating>('ok');
  });

  test('sessionMaxHours > 12 → locker', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 24 });
    expect(p.sessionRating).toBe<SessionRating>('locker');
  });

  test('sessionMaxHours = 1 → streng', () => {
    const p = computeSecurityPosture({ passwordMinLength: 8, passwordComplexity: 'medium', sessionMaxHours: 1 });
    expect(p.sessionRating).toBe<SessionRating>('streng');
  });
});

// ── computeSecurityPosture: MFA immer 0% ─────────────────────────────────────

describe('computeSecurityPosture – MFA', () => {
  test('mfaCoverage ist immer 0 — nicht implementiert', () => {
    const p1 = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 });
    const p2 = computeSecurityPosture({ passwordMinLength: 8, passwordComplexity: 'low', sessionMaxHours: 24 });
    expect(p1.mfaCoverage).toBe(0);
    expect(p2.mfaCoverage).toBe(0);
  });

  test('ssoConfigured ist immer false — nicht implementiert', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 });
    expect(p.ssoConfigured).toBe(false);
  });
});

// ── computeSecurityPosture: Score deterministisch ─────────────────────────────

describe('computeSecurityPosture – Score', () => {
  test('Score ist eine ganze Zahl zwischen 0 und 100', () => {
    const cases: SecurityPostureInput[] = [
      { passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 },
      { passwordMinLength: 8, passwordComplexity: 'low', sessionMaxHours: 24 },
      { passwordMinLength: 10, passwordComplexity: 'medium', sessionMaxHours: 8 },
    ];
    for (const c of cases) {
      const { score } = computeSecurityPosture(c);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  test('Optimale Einstellungen ergeben den höchsten Score', () => {
    const best = computeSecurityPosture({ passwordMinLength: 16, passwordComplexity: 'high', sessionMaxHours: 4 });
    const worst = computeSecurityPosture({ passwordMinLength: 6, passwordComplexity: 'low', sessionMaxHours: 24 });
    expect(best.score).toBeGreaterThan(worst.score);
  });

  test('Score ist NICHT hardcoded 76 — unterscheidet sich je nach Eingabe', () => {
    const a = computeSecurityPosture({ passwordMinLength: 16, passwordComplexity: 'high', sessionMaxHours: 2 });
    const b = computeSecurityPosture({ passwordMinLength: 8, passwordComplexity: 'low', sessionMaxHours: 24 });
    expect(a.score).not.toBe(b.score);
  });
});

// ── computeSecurityPosture: Empfehlungen ─────────────────────────────────────

describe('computeSecurityPosture – Empfehlungen', () => {
  test('Empfehlungen enthält MFA-Hinweis (nicht implementiert)', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 });
    const hasMfa = p.recommendations.some((r) => r.toLowerCase().includes('mfa') || r.toLowerCase().includes('multi-faktor'));
    expect(hasMfa).toBe(true);
  });

  test('Empfehlungen enthält SSO-Hinweis (nicht implementiert)', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 4 });
    const hasSso = p.recommendations.some((r) => r.toLowerCase().includes('sso') || r.toLowerCase().includes('oidc') || r.toLowerCase().includes('single sign'));
    expect(hasSso).toBe(true);
  });

  test('schwaches Passwort → Empfehlung zur Passwortlänge', () => {
    const p = computeSecurityPosture({ passwordMinLength: 6, passwordComplexity: 'low', sessionMaxHours: 8 });
    const hasPwRec = p.recommendations.some((r) =>
      r.toLowerCase().includes('passwort') || r.toLowerCase().includes('länge') || r.toLowerCase().includes('komplexität')
    );
    expect(hasPwRec).toBe(true);
  });

  test('lange Session → Empfehlung zur Sitzungsdauer', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 24 });
    const hasSessionRec = p.recommendations.some((r) =>
      r.toLowerCase().includes('sitzung') || r.toLowerCase().includes('session')
    );
    expect(hasSessionRec).toBe(true);
  });

  test('optimale Einstellungen: MFA + SSO noch in Empfehlungen (da nicht erzwungen)', () => {
    const p = computeSecurityPosture({ passwordMinLength: 16, passwordComplexity: 'high', sessionMaxHours: 2 });
    // MFA + SSO sind immer in den Empfehlungen, weil nie serverseitig erzwungen
    expect(p.recommendations.length).toBeGreaterThanOrEqual(2);
  });

  test('Passwort ok (≥8 + medium) → keine Passwortlängen-Empfehlung', () => {
    const p = computeSecurityPosture({ passwordMinLength: 12, passwordComplexity: 'high', sessionMaxHours: 8 });
    const hasPwLenRec = p.recommendations.some((r) =>
      r.toLowerCase().includes('mindestlänge') || r.toLowerCase().includes('min. länge')
    );
    expect(hasPwLenRec).toBe(false);
  });
});

// ── Boundary-Werte ────────────────────────────────────────────────────────────

describe('computeSecurityPosture – Boundary-Werte', () => {
  test('minimale Grenzwerte: length=1, complexity=low, session=1', () => {
    const p = computeSecurityPosture({ passwordMinLength: 1, passwordComplexity: 'low', sessionMaxHours: 1 });
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.passwordStrength).toBe<PasswordStrength>('schwach');
    expect(p.sessionRating).toBe<SessionRating>('streng');
  });

  test('maximale Grenzwerte: length=128, complexity=high, session=168', () => {
    const p = computeSecurityPosture({ passwordMinLength: 128, passwordComplexity: 'high', sessionMaxHours: 168 });
    expect(p.score).toBeLessThanOrEqual(100);
    expect(p.passwordStrength).toBe<PasswordStrength>('stark');
    expect(p.sessionRating).toBe<SessionRating>('locker');
  });
});
