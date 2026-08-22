/**
 * Page-level RBAC gate helpers.
 *
 * These functions mirror the server-side route protection so the UI can show a
 * meaningful empty state instead of fetching data the server will reject anyway.
 *
 * IMPORTANT: This is UX/defense-in-depth only.
 * The authoritative enforcement lives server-side (authenticate.js / requireRole).
 * Never rely on these functions alone for security decisions.
 *
 * Server-side mirrors:
 *   canViewQRadar  → GET /api/v1/qradar/* requires role analyst+
 */
import { can } from './rbac';

/** QRadar Analysis page: analyst+ (mirrors /qradar/* route gate). */
export function canViewQRadar(role: string | undefined): boolean {
  return can.act(role);
}
