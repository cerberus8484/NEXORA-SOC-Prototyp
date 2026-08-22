/**
 * Reine Helfer für BrandingPanel — kein React, keine API-Calls, testbar.
 * Kein Node-Buffer-Import — läuft in Vitest (jsdom) und im Browser.
 */

// Gültiges 6-stelliges CSS-Hex-Color: #rrggbb (Groß- oder Kleinschreibung)
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Prüft ob ein String ein gültiges 6-stelliges Hex-Color ist (#rrggbb).
 * Kurz-Schreibweise (#rgb) und CSS-Farbnamen werden abgelehnt.
 */
export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/**
 * Gibt den Hex-String zurück wenn gültig, sonst null.
 * Kein Silent-Fail — der Aufrufer muss ungültige Werte explizit behandeln.
 */
export function normalizeHexColor(value: string): string | null {
  return isValidHexColor(value) ? value : null;
}
