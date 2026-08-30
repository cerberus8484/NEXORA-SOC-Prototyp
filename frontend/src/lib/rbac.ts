// RBAC — spiegelt die Backend-Hierarchie (authenticate.js): admin > engineer > analyst > viewer.

export type Role = 'admin' | 'engineer' | 'analyst' | 'viewer' | 'agent';

const ROLE_LEVELS: Record<string, number> = {
  admin: 4,
  engineer: 3,
  analyst: 2,
  viewer: 1,
  agent: 1,
};

/** Hat `role` mindestens das Level von `required`? */
export function hasRole(role: string | undefined, required: Role): boolean {
  const have = ROLE_LEVELS[role ?? ''] ?? 0;
  const need = ROLE_LEVELS[required] ?? 99;
  return have >= need;
}

export const can = {
  view:   (role?: string) => hasRole(role, 'viewer'),
  act:    (role?: string) => hasRole(role, 'analyst'),   // erstellen, Lifecycle, FP weiterleiten
  apply:  (role?: string) => hasRole(role, 'engineer'),  // weitergeleitete FP-Ausnahme anwenden
  admin:  (role?: string) => hasRole(role, 'admin'),     // direkt anwenden, restart, erzwingen
};
