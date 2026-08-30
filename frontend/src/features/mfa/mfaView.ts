// mfaView — reine Anzeige-/Übergangs-Logik für die MFA-Security-Card.
// Kein React, kein API: gut testbar, deshalb als eigenes Modul (Projekt-Konvention).

import type { Tone } from '../../components/ui';
import type { MfaStatus } from './mfaApi';
import i18n from '../../i18n';

// ── Status-Beschriftung + Ton ────────────────────────────────────────────────

const STATUS_LABEL: Record<MfaStatus, string> = {
  none:     i18n.t('text.notSetUp'),
  pending:  i18n.t('mfa.setupPending'),
  active:   i18n.t('common.active'),
  disabled: i18n.t('common.disabled'),
};

const STATUS_TONE: Record<MfaStatus, Tone> = {
  none:     'muted',
  pending:  'warning',
  active:   'success',
  disabled: 'muted',
};

export function mfaStatusLabel(status: MfaStatus): string {
  return STATUS_LABEL[status] ?? 'Unbekannt';
}

export function mfaStatusTone(status: MfaStatus): Tone {
  return STATUS_TONE[status] ?? 'muted';
}

export function isMfaActive(status: MfaStatus): boolean {
  return status === 'active';
}

// ── Eingabe-Validierung (Code-Eingaben) ──────────────────────────────────────

// Ein TOTP-Token ist genau 6 Ziffern (RFC 6238). Whitespace ist erlaubt und
// wird vor der Prüfung entfernt (Nutzer tippen oft „123 456").
export function isValidTotpToken(token: string): boolean {
  return /^\d{6}$/.test(token.replace(/\s+/g, ''));
}

// Zum Deaktivieren akzeptiert das Backend ENTWEDER einen TOTP-Code ODER einen
// Recovery-Code. Wir validieren hier nur grob „nicht leer + Mindestlänge" und
// lassen die echte Prüfung serverseitig (kein Format-Lock-in im Client).
const MIN_DISABLE_CODE_LENGTH = 6;
export function isValidDisableCode(code: string): boolean {
  return code.trim().length >= MIN_DISABLE_CODE_LENGTH;
}

// ── Recovery-Codes ───────────────────────────────────────────────────────────

// Immutable: gibt eine bereinigte Kopie zurück (verwirft leere Einträge).
export function formatRecoveryCodes(codes: readonly string[]): string[] {
  return codes.map((c) => c.trim()).filter((c) => c.length > 0);
}

// Codes zum Kopieren/Download — eine Zeile je Code.
export function recoveryCodesText(codes: readonly string[]): string {
  return formatRecoveryCodes(codes).join('\n');
}

const LOW_RECOVERY_THRESHOLD = 2;

// Ton für „N von M Recovery-Codes übrig". 0 → danger, knapp → warning.
export function recoveryRemainingTone(
  remaining: number | undefined,
  _total: number | undefined,
): Tone {
  if (remaining === undefined) return 'muted';
  if (remaining <= 0) return 'danger';
  if (remaining <= LOW_RECOVERY_THRESHOLD) return 'warning';
  return 'success';
}

// ── Enroll-Step-Reducer (reine Zustandsmaschine) ─────────────────────────────

export type EnrollStep = 'idle' | 'showSecret' | 'verifying' | 'done';
export type EnrollAction = 'enroll' | 'verify' | 'verified' | 'fail' | 'cancel';

// Erlaubte Übergänge. Unbekannte Kombinationen lassen den Schritt unverändert.
const TRANSITIONS: Partial<Record<EnrollStep, Partial<Record<EnrollAction, EnrollStep>>>> = {
  idle:       { enroll: 'showSecret' },
  showSecret: { verify: 'verifying' },
  verifying:  { verified: 'done', fail: 'showSecret' },
};

export function nextEnrollStep(step: EnrollStep, action: EnrollAction): EnrollStep {
  if (action === 'cancel') return 'idle';
  return TRANSITIONS[step]?.[action] ?? step;
}
