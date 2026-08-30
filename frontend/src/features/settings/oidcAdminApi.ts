// OIDC In-UI-Admin-API (P1 #6) — admin-only Konfiguration des SSO-Logins.
//
// GET  /settings/oidc       — maskiert (clientSecretSet statt Secret)
// PUT  /settings/oidc       — Patch (clientSecret leer = unverändert)
// POST /settings/oidc/test  — Discovery-Probe gegen den Issuer
//
// Das Client-Secret kommt NIE im GET zurück (verschlüsselt im Backend); es wird
// nur gesendet, wenn der Admin ein neues eintippt.

import { api } from '../../lib/apiClient';

export type OidcDefaultRole = 'viewer' | 'analyst' | 'engineer';

/** Admin-Sicht der OIDC-Config (ohne Secret-Wert). */
export interface OidcAdminConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  defaultRole: OidcDefaultRole;
  allowSignup: boolean;
  clientSecretSet: boolean; // liegt ein Secret vor?
  configured: boolean;      // issuer + clientId + secret vollständig?
}

/** Schreib-Patch — alle Felder optional; clientSecret leer/weggelassen = unverändert. */
export interface OidcConfigPatch {
  enabled?: boolean;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
  defaultRole?: OidcDefaultRole;
  allowSignup?: boolean;
}

export interface OidcTestResult {
  ok: boolean;
  latencyMs?: number;
  issuer?: string;
  error?: string;
}

interface OidcConfigEnvelope { data: OidcAdminConfig; }
interface OidcTestEnvelope { data: OidcTestResult; }

const VALID_ROLES: readonly OidcDefaultRole[] = ['viewer', 'analyst', 'engineer'];
const asStr  = (v: unknown): string  => (typeof v === 'string' ? v : '');
const asBool = (v: unknown): boolean => v === true;

/**
 * Härtet die externe OIDC-Config zu einer garantiert wohlgeformten OidcAdminConfig.
 * Boundary-Validierung: alle String-Felder sind nie undefined → die SecurityTab
 * crasht nicht mehr, wenn das Backend (oder ein Mock) eine partielle/fremde Shape
 * liefert (z.B. data=[]). Unbekannte defaultRole fällt auf 'viewer'.
 */
export function normalizeOidcConfig(raw: unknown): OidcAdminConfig {
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const role = c.defaultRole as OidcDefaultRole;
  return {
    enabled:         asBool(c.enabled),
    issuer:          asStr(c.issuer),
    clientId:        asStr(c.clientId),
    redirectUri:     asStr(c.redirectUri),
    scope:           asStr(c.scope),
    defaultRole:     VALID_ROLES.includes(role) ? role : 'viewer',
    allowSignup:     asBool(c.allowSignup),
    clientSecretSet: asBool(c.clientSecretSet),
    configured:      asBool(c.configured),
  };
}

export async function getOidcConfig(): Promise<OidcAdminConfig> {
  const env = await api.get<OidcConfigEnvelope>('/settings/oidc');
  return normalizeOidcConfig(env?.data);
}

/** Speichert die OIDC-Config. `password` ist die Step-up-Reauth des Admins (Server prüft es online). */
export async function saveOidcConfig(patch: OidcConfigPatch, password: string): Promise<OidcAdminConfig> {
  const env = await api.put<OidcConfigEnvelope>('/settings/oidc', { ...patch, password });
  return normalizeOidcConfig(env?.data);
}

/** Verbindungstest gegen den (optional übergebenen, sonst gespeicherten) Issuer. */
export async function testOidcConnection(issuer?: string): Promise<OidcTestResult> {
  const env = await api.post<OidcTestEnvelope>('/settings/oidc/test', issuer ? { issuer } : {});
  return env.data;
}
