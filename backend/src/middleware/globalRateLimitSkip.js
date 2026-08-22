'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Skip-Prädikat für den globalen (per-IP) Rate-Limiter.
//
// Ausgenommen:
//  1. Integrations-Webhooks — haben einen eigenen, großzügigen Limiter.
//  2. Der authentifizierte Ticket-Triage-Hot-Path:
//       • GET  /tickets       (Listen-Reload nach jeder Aktion / Deck-Wechsel)
//       • PUT  /tickets/:id    (Status-Update / Ticket schließen)
//     Ein Analyst, der mehrere Tickets in Folge schließt, ist normaler SOC-Workflow
//     und darf nicht mit „Too many requests" blockiert werden. Beide Endpunkte sind
//     auth-gated (requireAuth/requireRole); PUT wird auditiert. Login, Create, Delete,
//     Bulk-Ops, Export und Suche bleiben limitiert (Flood-/Brute-Force-Schutz).
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} v1  API-Prefix (z. B. '/api/v1')
 * @returns {(req: {method: string, path: string}) => boolean}
 */
function makeGlobalRateLimitSkip(v1) {
  const ticketList = `${v1}/tickets`;
  // Genau ein Pfadsegment nach /tickets/ (Item-ID) — nicht /tickets/bulk-delete o. Ä. mit weiteren Segmenten.
  const ticketItem = new RegExp(`^${v1}/tickets/[^/]+$`);

  return function shouldSkipGlobalLimit(req) {
    const path = req.path || '';
    if (path.startsWith(`${v1}/integrations`)) return true;
    if (req.method === 'GET' && path === ticketList) return true;
    if (req.method === 'PUT' && ticketItem.test(path)) return true;
    return false;
  };
}

module.exports = { makeGlobalRateLimitSkip };
