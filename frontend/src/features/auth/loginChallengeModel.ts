// Reine Client-Logik für den MFA-Challenge-Schritt im Login.
// Das Backend ist die echte Schranke (verifiziert TOTP/Recovery-Code) — diese
// Validierung verhindert nur offensichtlich unbrauchbare Eingaben vor dem Request.

/** TOTP-Codes sind 6-stellig; Recovery-Codes sind kürzere Strings (>= 6 Zeichen). */
const MIN_CODE_LENGTH = 6;

/**
 * Validierungsfehler als Übersetzungs-Schlüssel statt als fertiger Satz.
 *
 * Diese Schicht kennt keine Sprache: Sie liefert, WAS falsch ist, und die UI
 * entscheidet, in welcher Sprache das erscheint. Ein hier fest verdrahteter
 * deutscher Satz würde in einem englischen UI durchschlagen — genau der Grund,
 * warum die Meldung nicht in der Logik stehen darf.
 */
export interface ValidationError {
  key: string;
  /** Interpolationswerte für den Übersetzungstext (z. B. Mindestlänge). */
  params?: Record<string, string | number>;
}

/**
 * Normalisiert die Code-Eingabe: trimmt, entfernt gängige Trennzeichen
 * (Leerzeichen/Bindestriche aus formatierten TOTP-/Recovery-Codes) und
 * normalisiert auf Großschreibung, damit Recovery-Codes case-insensitiv sind.
 * TOTP-Ziffern bleiben unverändert.
 */
export function normalizeMfaCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Validiert die normalisierte Code-Eingabe. Gibt einen ValidationError zurück
 * oder null, wenn die Eingabe plausibel ist (6-stelliger TOTP-Code ODER
 * alphanumerischer Recovery-Code). Der eigentliche Abgleich passiert im Backend.
 */
export function validateMfaCode(raw: string): ValidationError | null {
  const code = normalizeMfaCode(raw);
  if (!code) return { key: 'validation.mfaCodeRequired' };
  if (code.length < MIN_CODE_LENGTH) {
    return { key: 'validation.mfaCodeTooShort', params: { min: MIN_CODE_LENGTH } };
  }
  if (!/^[A-Z0-9]+$/.test(code)) return { key: 'validation.mfaCodeInvalidChars' };
  return null;
}
