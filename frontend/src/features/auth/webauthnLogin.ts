import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from '../../lib/apiClient';

/**
 * WebAuthn/Passkey-Frontend (Slice 2d).
 *
 * Anders als OIDC (volle Navigation) sind die Passkey-Ceremonies AJAX:
 * Options vom Backend holen → Browser-WebAuthn-API (@simplewebauthn/browser) →
 * Response zurück an den Verify-Endpunkt. Der Session-Cookie wird serverseitig
 * gesetzt (httpOnly) — hier wird nie ein Token angefasst.
 */

export interface WebauthnCredential {
  id: string;
  label: string;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Ob Passkeys serverseitig aktiv sind (steuert die Button-Sichtbarkeit). */
export const getWebauthnStatus = (signal?: AbortSignal): Promise<{ enabled: boolean }> =>
  api.get<{ enabled: boolean }>('/auth/webauthn/status', undefined, { signal });

/** Browser-seitige Passkey-Unterstützung (kein WebAuthn auf z.B. alten Browsern). */
export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/** Login per Passkey: Options → Ceremony → verify. Session-Cookie wird gesetzt. */
export async function loginWithPasskey(): Promise<void> {
  const { options } = await api.post<{ options: PublicKeyCredentialRequestOptionsJSON }>(
    '/auth/webauthn/login/options', {},
  );
  const response = await startAuthentication({ optionsJSON: options });
  await api.post('/auth/webauthn/login/verify', { response });
}

/** Neuen Passkey registrieren (eingeloggt). Optionales Label (z.B. „YubiKey 5"). */
export async function registerPasskey(label?: string): Promise<WebauthnCredential> {
  const { options } = await api.post<{ options: PublicKeyCredentialCreationOptionsJSON }>(
    '/auth/webauthn/register/options', {},
  );
  const response = await startRegistration({ optionsJSON: options });
  const { data } = await api.post<{ data: WebauthnCredential }>(
    '/auth/webauthn/register/verify', { response, label },
  );
  return data;
}

/** Eigene registrierte Passkeys (Listing-Sicht, ohne Schlüsselmaterial). */
export const listPasskeys = (signal?: AbortSignal): Promise<WebauthnCredential[]> =>
  api
    .get<{ data: WebauthnCredential[] }>('/auth/webauthn/credentials', undefined, { signal })
    .then((r) => r.data);

/** Einen eigenen Passkey entfernen. */
export const deletePasskey = (id: string): Promise<void> =>
  api.del(`/auth/webauthn/credentials/${id}`).then(() => undefined);
