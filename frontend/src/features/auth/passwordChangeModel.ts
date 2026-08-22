// Reine Client-Validierung für die Passwortänderung (Backend ist die echte Schranke).

export const MIN_PASSWORD = 8;

export function validatePasswordChange(current: string, next: string, confirm: string): string | null {
  if (!current || !next) return 'Bitte aktuelles und neues Passwort eingeben';
  if (next.length < MIN_PASSWORD) return `Neues Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben`;
  if (next !== confirm) return 'Die neuen Passwörter stimmen nicht überein';
  if (next === current) return 'Neues Passwort muss sich vom aktuellen unterscheiden';
  return null;
}
