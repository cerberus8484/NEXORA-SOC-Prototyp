// Reine Entscheidungslogik für refreshUser (auth.tsx) — kein React, kein DOM,
// testbar in Vitest ohne jsdom.
//
// Hardrule (CLAUDE.md): „leer" ≠ „Fehler". Beim Neuladen von /auth/me darf nur
// ein echtes 401 (Session weg / Token ungültig) den Auth-State auf „ausgeloggt"
// setzen. Ein Netz-/Server-Fehler (Status 0, 5xx, …) DARF den eingeloggten User
// NICHT verwerfen — sonst fliegt der Analyst bei einem Backend-Hänger grundlos
// raus (stale-Auth-Bug) und verliert seinen Arbeitskontext.

import { ApiError } from './apiClient';

/**
 * Entscheidet, ob ein Fehler aus dem /auth/me-Refresh den Auth-State leeren soll.
 *
 * @returns true  → nur bei echtem 401 (Session ungültig) → User auf null setzen.
 *          false → Netz/Server/sonstiger Fehler → User-State unangetastet lassen.
 */
export function shouldClearAuthOnRefreshError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
