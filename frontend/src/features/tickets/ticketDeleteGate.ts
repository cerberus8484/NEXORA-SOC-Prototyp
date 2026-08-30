// Reine Lösch-Gate-Logik für Tickets — spiegelt die Backend-RBAC (admin only).
// Bewusst frei von React/DOM, damit sie isoliert testbar ist.
import { can } from '../../lib/rbac';

/**
 * Darf die Rolle ein Ticket löschen? Nur `admin` (RBAC-Hierarchie aus rbac.ts).
 * Das ist nur das UI-Gate — der Backend-Endpoint erzwingt die Berechtigung erneut.
 */
export function canDeleteTicket(role: string | undefined): boolean {
  return can.admin(role);
}
