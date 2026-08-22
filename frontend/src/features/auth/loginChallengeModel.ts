// Reine Client-Logik für den MFA-Challenge-Schritt im Login.
// Das Backend ist die echte Schranke (verifiziert TOTP/Recovery-Code) — diese
// Validierung verhindert nur offensichtlich unbrauchbare Eingaben vor dem Request.

/** TOTP-Codes sind 6-stellig; Recovery-Codes sind kürzere Strings (>= 6 Zeichen). */
const MIN_CODE_LENGTH = 6;

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
 * Validiert die normalisierte Code-Eingabe. Gibt eine Fehlermeldung zurück
 * oder null, wenn die Eingabe plausibel ist (6-stelliger TOTP-Code ODER
 * alphanumerischer Recovery-Code). Der eigentliche Abgleich passiert im Backend.
 */
export function validateMfaCode(raw: string): string | null {
  const code = normalizeMfaCode(raw);
  if (!code) return 'Bitte den Bestätigungscode eingeben';
  if (code.length < MIN_CODE_LENGTH) return `Code muss mindestens ${MIN_CODE_LENGTH} Zeichen haben`;
  if (!/^[A-Z0-9]+$/.test(code)) return 'Code darf nur Buchstaben und Ziffern enthalten';
  return null;
}
