// Reine Logik für die Admin-Benutzerverwaltung (UI-frei, testbar).

export const ROLES = ['admin', 'engineer', 'analyst', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export interface ManagedUser {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
}

export function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/**
 * Darf der eingeloggte Admin diese Aktion am Zielnutzer ausführen?
 * Selbst-Deaktivierung und Selbst-Degradierung sind gesperrt (Lockout-Schutz) —
 * spiegelt die Backend-Schranke, damit die UI sie gar nicht erst anbietet.
 */
export function canDeactivate(actingUserId: string, target: ManagedUser): boolean {
  return actingUserId !== target.id;
}

export function canChangeRoleTo(actingUserId: string, target: ManagedUser, nextRole: string): boolean {
  if (!isValidRole(nextRole)) return false;
  if (actingUserId === target.id && nextRole !== 'admin') return false;
  return true;
}
