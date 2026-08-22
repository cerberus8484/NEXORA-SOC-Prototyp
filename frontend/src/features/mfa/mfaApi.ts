// mfaApi — typisierter Client für die TOTP-MFA-Selbstverwaltung (/v1/mfa).
// Jeder eingeloggte User verwaltet seine EIGENE MFA: Status, Enroll, Verify, Disable.
// Der apiClient hängt die Basis /api/v1 an → hier nur relative Pfade.
// Sicherheit: secret/otpauthUri/recoveryCodes sind Geheimnisse — werden NUR im
// Komponenten-State gehalten, nie geloggt, nie persistiert.

import { api } from '../../lib/apiClient';

export type MfaStatus = 'none' | 'pending' | 'active' | 'disabled';

export interface MfaStatusResponse {
  status: MfaStatus;
  recoveryCodesRemaining?: number;
  recoveryCodesTotal?: number;
  activatedAt?: string | null;
}

// Enrollment-Hülle aus dem Backend (Status + Metadaten). Wir lesen daraus nur,
// was die UI braucht; unbekannte Felder bleiben erhalten.
export interface MfaEnrollment {
  status: 'pending' | 'active';
  [key: string]: unknown;
}

export interface MfaEnrollResponse {
  secret: string;        // Base32 — manuell in die Authenticator-App eintragen
  otpauthUri: string;    // otpauth://totp/... — kopierbar
  enrollment: MfaEnrollment;
}

export interface MfaVerifyResponse {
  recoveryCodes: string[];  // EINMALIG sichtbar — danach nicht erneut abrufbar
  enrollment: MfaEnrollment;
}

export interface MfaDisableResponse {
  status: 'disabled';
}

export const mfaApi = {
  /** GET /mfa/status — aktueller MFA-Zustand des eingeloggten Users. */
  getStatus: (opts?: { signal?: AbortSignal }) =>
    api.get<MfaStatusResponse>('/mfa/status', undefined, opts),

  /** POST /mfa/enroll — Secret + otpauth-URI erzeugen (Status → pending). */
  enroll: () => api.post<MfaEnrollResponse>('/mfa/enroll'),

  /** POST /mfa/verify — TOTP-Code prüfen; aktiviert MFA + liefert Recovery-Codes. */
  verify: (token: string) => api.post<MfaVerifyResponse>('/mfa/verify', { token }),

  /** POST /mfa/disable — MFA deaktivieren (TOTP- oder Recovery-Code Pflicht). */
  disable: (code: string) => api.post<MfaDisableResponse>('/mfa/disable', { code }),
};
