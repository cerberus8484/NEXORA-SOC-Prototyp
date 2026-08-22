import { API_BASE } from '../../lib/apiClient';

/**
 * Reine SSO-Login-Logik (OIDC Slice 2).
 *
 * Der SSO-Login ist eine VOLLE Browser-Navigation (kein fetch): der Browser geht
 * auf den Backend-Endpunkt, der mit 302 zum IdP weiterleitet. Daher eine URL-
 * Konstante statt eines API-Aufrufs.
 */

// Ziel der „Mit SSO anmelden"-Navigation.
export const OIDC_LOGIN_URL = `${API_BASE}/auth/oidc/login`;

/**
 * True, wenn der Login mit ?sso_error=1 zurückkam (SSO-Flow ist fehlgeschlagen).
 * Der Backend-Callback leitet im Fehlerfall bewusst generisch hierher zurück.
 * @param search — location.search (inkl. führendem '?')
 */
export function hasSsoError(search: string): boolean {
  return new URLSearchParams(search).get('sso_error') === '1';
}
