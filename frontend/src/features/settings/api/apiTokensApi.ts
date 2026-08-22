// apiTokensApi — Personal Access Tokens (PAT)
//
// GET /tokens      → eigene Tokens auflisten
// POST /tokens     → neues Token erstellen (gibt plain token EINMALIG zurück)
// DELETE /tokens/:id → Token widerrufen
//
// SICHERHEITS-INVARIANTE:
//   - ApiTokenItem enthält NIEMALS tokenHash oder den vollen Token-Wert
//   - prefix ist IMMER nur die ersten 12 Zeichen + "..." — kein Vollwert
//   - CreateTokenResult.token wird EINMALIG angezeigt und dann verworfen

import { api } from '../../../lib/apiClient';

// ── Typen ────────────────────────────────────────────────────────────────────

/**
 * Ein persönlicher API-Token in der Listenansicht.
 * KEIN tokenHash-Feld — das Backend sendet ihn nicht.
 */
export interface ApiTokenItem {
  id:         string;
  userId:     string;
  name:       string;
  prefix:     string;       // "soc_XXXXXXXX..." — erste 12 Zeichen + "..."
  createdAt:  string;
  expiresAt:  string | null;
  lastUsedAt: string | null;
  revoked:    boolean;
}

/**
 * Einmaliges Ergebnis der Token-Erstellung.
 * token ist der Klartext-Token — EINMALIG anzeigen, dann verwerfen.
 */
export interface CreateTokenResult {
  token:    string;         // soc_ + 64 hex chars — EINMALIG
  apiToken: ApiTokenItem;
}

/** Prefix-Länge für die Anzeige: soc_XXXXXXXX = 12 Zeichen + "..." */
export const TOKEN_DISPLAY_PREFIX_LEN = 12;

// ── API-Funktionen ────────────────────────────────────────────────────────────

interface TokenListEnvelope {
  data:       ApiTokenItem[];
  requestId?: string;
}

/** Holt eigene Tokens (user-scoped, auth erforderlich). */
export async function listTokens(): Promise<ApiTokenItem[]> {
  const envelope = await api.get<TokenListEnvelope>('/tokens');
  return envelope.data ?? [];
}

interface CreateTokenPayload {
  name:       string;
  expiresAt?: string;
}

/** Erstellt einen neuen PAT. Gibt token EINMALIG zurück — danach nicht mehr rekonstruierbar. */
export async function createToken({ name, expiresAt }: CreateTokenPayload): Promise<CreateTokenResult> {
  return api.post<CreateTokenResult>('/tokens', { name, expiresAt });
}

/** Widerruft einen eigenen Token per ID. */
export async function revokeToken(tokenId: string): Promise<void> {
  await api.del<void>(`/tokens/${tokenId}`);
}
