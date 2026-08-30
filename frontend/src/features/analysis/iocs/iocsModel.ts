// Reine, testbare Ableitungen für IoCs & Decision. Quelle: abgeleitete Ticket-IoCs + Entities +
// Evidence (MITRE). KEINE erfundenen Reputationen/Quellen — Confidence wird ehrlich aus der
// (real ermittelten) Reputation abgeleitet, nicht erfunden.
import type { Ioc, IocType, ParsedEvidence } from '../analysisModel';
import type { EntityItem } from '../deckModel';

export interface IocCounts {
  total: number; ip: number; domain: number; hash: number; file: number; url: number;
  process: number; user: number; mitre: number;
}
export function iocCounts(iocs: Ioc[], entities: EntityItem[], ev: ParsedEvidence): IocCounts {
  const c = (t: IocType) => iocs.filter((i) => i.type === t).length;
  const ek = (k: EntityItem['kind']) => entities.filter((e) => e.kind === k).length;
  const mitre = [ev.metadata.mitreTechnique, ev.metadata.mitreTactic].filter((v) => v && String(v).trim()).length;
  return {
    total: iocs.length,
    ip: c('ip'), domain: c('domain'), hash: c('hash'), file: c('file'), url: c('url'),
    process: ek('process'), user: ek('user'), mitre,
  };
}

export type IocConfidence = 'high' | 'medium' | 'low' | null;
/** Confidence = Stärke der real ermittelten Reputation (kein erfundener Score). */
export function iocConfidence(reputation?: string): IocConfidence {
  if (reputation === 'malicious') return 'high';
  if (reputation === 'suspicious') return 'medium';
  if (reputation === 'harmless') return 'low';
  return null;
}

/** Block-/Watchlist-Empfehlung: nur IoCs mit malicious/suspicious Reputation. */
export function recommendedBlocks(iocs: Ioc[]): Ioc[] {
  return iocs.filter((i) => i.reputation === 'malicious' || i.reputation === 'suspicious');
}
