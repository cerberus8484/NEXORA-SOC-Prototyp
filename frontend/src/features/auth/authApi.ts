import { api } from '../../lib/apiClient';
import type { User } from '../../lib/auth';

/**
 * Antwort von POST /auth/mfa nach erfolgreicher Verifikation des 2. Faktors.
 * Das Backend setzt die Session als httpOnly-Cookie — der Client hält bewusst
 * KEIN Token im JS (das Token-Feld der Response wird daher nicht typisiert/genutzt).
 */
export interface MfaVerifyResponse {
  user: User;
}

// Antwort von POST /auth/mfa-setup/begin (erzwungenes Enrollment).
export interface MfaSetupBeginResponse {
  secret: string;
  otpauthUri: string;
}

// Antwort von POST /auth/mfa-setup/complete — Session via Cookie + einmalige Recovery-Codes.
export interface MfaSetupCompleteResponse {
  user: User;
  recoveryCodes: string[];
}

// Auth-API — eigenes Passwort ändern + MFA-Challenge abschließen
// (Backend ist die echte Schranke).
export const authApi = {
  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    api.post<{ ok: boolean }>('/auth/change-password', { currentPassword, newPassword }).then(() => undefined),

  /**
   * Verifiziert den 2. Faktor zur Login-Challenge. `code` ist ein 6-stelliger
   * TOTP-Code ODER ein Recovery-Code — das Backend entscheidet, was gültig ist.
   * Bei falschem Code antwortet das Backend mit HTTP 401 → apiClient wirft ApiError.
   */
  verifyMfa: (challengeToken: string, code: string): Promise<MfaVerifyResponse> =>
    api.post<MfaVerifyResponse>('/auth/mfa', { challengeToken, code }),

  /** Startet erzwungenes MFA-Enrollment (org-weite Pflicht) mit dem Setup-Token. */
  beginMfaSetup: (setupToken: string): Promise<MfaSetupBeginResponse> =>
    api.post<MfaSetupBeginResponse>('/auth/mfa-setup/begin', { setupToken }),

  /** Schließt erzwungenes Enrollment ab → Session + einmalige Recovery-Codes. */
  completeMfaSetup: (setupToken: string, code: string): Promise<MfaSetupCompleteResponse> =>
    api.post<MfaSetupCompleteResponse>('/auth/mfa-setup/complete', { setupToken, code }),

  /**
   * Fragt ab, ob SSO/OIDC serverseitig aktiv ist (steuert den SSO-Button).
   * Öffentlich erreichbar — liefert nur ein Boolean, kein Secret.
   */
  getOidcStatus: (signal?: AbortSignal): Promise<{ enabled: boolean }> =>
    api.get<{ enabled: boolean }>('/auth/oidc/status', undefined, { signal }),
};
