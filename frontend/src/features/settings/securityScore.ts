// Reine Logik für den Security-Posture-Score — kein JSX, kein DOM, kein IO.
// ADR-009: Nur echte Signale → Score ist transparent und deterministisch.
//
// Echt erzwungen:  passwordMinLength, passwordComplexity, sessionMaxHours
// Nicht erzwungen: MFA (0 %), SSO (false), IP-Allowlist, TLS, Ablauf, History

import type { PlatformSettings } from './settingsApi';
import i18n from '../../i18n';

export type PasswordStrength = 'stark' | 'ok' | 'schwach';
export type SessionRating    = 'streng' | 'ok' | 'locker';

export type SecurityPostureInput = Pick<
  PlatformSettings,
  'passwordMinLength' | 'passwordComplexity' | 'sessionMaxHours'
>;

export interface SecurityPosture {
  /** 0–100, ganzzahlig, aus echten Signalen berechnet. */
  score: number;
  passwordStrength: PasswordStrength;
  sessionRating: SessionRating;
  /** Immer 0 — MFA ist nicht implementiert. */
  mfaCoverage: 0;
  /** Immer false — SSO ist nicht konfiguriert/erzwungen. */
  ssoConfigured: false;
  /** Liste offener Punkte (ehrlich: MFA + SSO immer dabei, + situative Punkte). */
  recommendations: string[];
}

// ── Passwort-Stärke ───────────────────────────────────────────────────────────

function evalPasswordStrength(
  minLength: number,
  complexity: PlatformSettings['passwordComplexity'],
): PasswordStrength {
  if (minLength < 8) return 'schwach';
  if (complexity === 'low') return 'schwach';
  if (minLength >= 12) return 'stark';
  // minLength 8–11 mit medium oder high
  return 'ok';
}

// ── Sitzungs-Rating ───────────────────────────────────────────────────────────

function evalSessionRating(maxHours: number): SessionRating {
  if (maxHours <= 4) return 'streng';
  if (maxHours <= 12) return 'ok';
  return 'locker';
}

// ── Score (0–100) ─────────────────────────────────────────────────────────────
// Faktoren und Gewichtung (transparent, keine Magie):
//   Passwort-Stärke:    stark=35, ok=20, schwach=0
//   Sitzungs-Rating:    streng=25, ok=15, locker=0
//   Komplexität medium: +5, high: +10
//   MFA:                0 Punkte (nicht implementiert)
//   SSO:                0 Punkte (nicht konfiguriert)

const SCORE_PASSWORD: Record<PasswordStrength, number> = { stark: 35, ok: 20, schwach: 0 };
const SCORE_SESSION:  Record<SessionRating, number>    = { streng: 25, ok: 15, locker: 0 };
const SCORE_COMPLEXITY: Record<PlatformSettings['passwordComplexity'], number> = {
  low:    0,
  medium: 5,
  high:   10,
};

// Längenbonus: +1 pro Zeichen über 12 (max 5), damit 16+ Zeichen sichtbar besser sind.
function lengthBonus(minLength: number): number {
  return Math.min(5, Math.max(0, minLength - 12));
}

function calcScore(
  pwStrength: PasswordStrength,
  sessionRating: SessionRating,
  complexity: PlatformSettings['passwordComplexity'],
  minLength: number,
): number {
  const raw =
    SCORE_PASSWORD[pwStrength] +
    SCORE_SESSION[sessionRating] +
    SCORE_COMPLEXITY[complexity] +
    lengthBonus(minLength);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

// ── Empfehlungen (ehrlich, situativ) ─────────────────────────────────────────

function buildRecommendations(
  pwStrength: PasswordStrength,
  sessionRating: SessionRating,
  complexity: PlatformSettings['passwordComplexity'],
): string[] {
  const recs: string[] = [];

  // MFA + SSO: immer dabei — nie serverseitig erzwungen
  recs.push(i18n.t('settings.enableMfaMultiFactorAuthentication'));
  recs.push(i18n.t('settings.enableSsoOidc'));

  if (pwStrength === 'schwach') {
    if (complexity === 'low') {
      recs.push(i18n.t('label.raisePasswordComplexityMediumHigh'));
    }
    recs.push(i18n.t('settings.raiseMinimumLength12Characters'));
  }

  if (sessionRating === 'locker') {
    recs.push(i18n.t('settings.reduceSessionTo12h'));
  }

  if (pwStrength === 'ok' && complexity !== 'high') {
    recs.push(i18n.t('label.raisePasswordComplexityHighStronger'));
  }

  return recs;
}

// ── Öffentliche Funktion ──────────────────────────────────────────────────────

export function computeSecurityPosture(input: SecurityPostureInput): SecurityPosture {
  const pwStrength    = evalPasswordStrength(input.passwordMinLength, input.passwordComplexity);
  const sessionRating = evalSessionRating(input.sessionMaxHours);
  const score         = calcScore(pwStrength, sessionRating, input.passwordComplexity, input.passwordMinLength);
  const recommendations = buildRecommendations(pwStrength, sessionRating, input.passwordComplexity);

  return {
    score,
    passwordStrength: pwStrength,
    sessionRating,
    mfaCoverage:   0,
    ssoConfigured: false,
    recommendations,
  };
}
