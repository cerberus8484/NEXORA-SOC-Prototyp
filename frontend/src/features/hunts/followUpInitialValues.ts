import type { HuntFinding, HuntSession } from '../../lib/types';

/**
 * Vorbelegungswerte für den „Neuer Hunt"-Dialog, wenn ein Follow-up-Hunt
 * aus einem konkreten Finding gestartet wird (Audit-Fund #2).
 *
 * Reine Ableitungs-Logik (DOM-/API-frei → testbar). Priorität:
 *   targetHost ← finding.context.host, sonst session.targetHost
 *   sourceIp   ← finding.context.sourceIp (nur wenn gesetzt)
 *   ticketId   ← finding.ticketId, sonst session.ticketId
 *   huntType   ← optional aus explizit übergebenem Kontext (kein Raten aus dem Finding)
 *
 * Leere/undefinierte Felder werden weggelassen, damit das Modal seine eigenen
 * Defaults behalten kann. Ein leerer String zählt als „nicht gesetzt".
 */
export interface HuntInitialValues {
  targetHost?: string;
  huntType?: string;
  sourceIp?: string;
  ticketId?: string;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

export function followUpInitialValues(
  finding: HuntFinding | null | undefined,
  session: HuntSession | null | undefined,
): HuntInitialValues {
  if (!finding) return {};
  const ctx = finding.context ?? {};

  const result: HuntInitialValues = {};

  const targetHost = firstNonEmpty(ctx.host, session?.targetHost);
  if (targetHost) result.targetHost = targetHost;

  const sourceIp = firstNonEmpty(ctx.sourceIp);
  if (sourceIp) result.sourceIp = sourceIp;

  const ticketId = firstNonEmpty(finding.ticketId, session?.ticketId);
  if (ticketId) result.ticketId = ticketId;

  return result;
}
