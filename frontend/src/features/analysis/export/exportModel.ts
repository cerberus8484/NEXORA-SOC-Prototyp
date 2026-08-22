// Reine, testbare Export-Logik. Es gibt nur echte Exporte (JSON via Backend mit Chain-of-Custody,
// PDF/TXT/Markdown clientseitig). Der Scope filtert den Markdown/Report-Inhalt wirklich (keine
// funktionslosen Toggles). TLP/Watermark werden in den Report-Header geschrieben. Keine erfundenen
// Inhalte — fehlende Abschnitte erscheinen als „keine".
import type { Ticket } from '../../../lib/types';
import type { TicketTimeline, Ioc } from '../analysisModel';
import type { SummaryBullet, EntityItem } from '../deckModel';

export interface ExportScope { summary: boolean; iocs: boolean; entities: boolean; timeline: boolean; decision: boolean }
export const FULL_SCOPE: ExportScope = { summary: true, iocs: true, entities: true, timeline: true, decision: true };

export interface ScopeItem { key: keyof ExportScope; label: string; description: string; count: number }
export function exportScopeItems(bullets: SummaryBullet[], iocs: Ioc[], entities: EntityItem[], tl: TicketTimeline | null, t: Ticket): ScopeItem[] {
  return [
    { key: 'summary', label: 'Analyst Summary', description: 'Abgeleitete Zusammenfassung & Befunde', count: bullets.length },
    { key: 'iocs', label: 'IoCs & TI', description: 'Indicators of Compromise', count: iocs.length },
    { key: 'entities', label: 'Entities', description: 'Hosts, User, IPs, Hashes, Prozesse', count: entities.length },
    { key: 'timeline', label: 'Timeline', description: 'Chronologische Events', count: tl?.count ?? 0 },
    { key: 'decision', label: 'Decision & Recommendation', description: 'Analysten-Entscheidung & Empfehlung', count: (t.decision || t.recommendation) ? 1 : 0 },
  ];
}

export function selectedCount(items: ScopeItem[], scope: ExportScope): number {
  return items.filter((i) => scope[i.key]).reduce((sum, i) => sum + i.count, 0);
}

export interface ExportMeta { classification?: string; watermark?: string; preparedBy?: string }

/** Baut den Report-Markdown aus den ausgewählten Abschnitten — der Scope filtert wirklich. */
export function buildScopedMarkdown(
  t: Ticket, bullets: SummaryBullet[], iocs: Ioc[], entities: EntityItem[], tl: TicketTimeline | null,
  scope: ExportScope, meta: ExportMeta = {},
): string {
  const lines: string[] = [`# Incident Report — ${t.ticketNr || t.id}`];
  if (meta.classification) lines.push(`**Classification:** ${meta.classification}`);
  lines.push(`**Prepared by:** ${meta.preparedBy || '—'} · **Date:** ${new Date().toLocaleString('de-DE')}`);
  lines.push(`**Title:** ${t.title || '—'} · **Priority:** ${t.priority} · **Status:** ${t.status}`, '');

  if (scope.summary) lines.push('## Analyst Summary', ...(bullets.length ? bullets.map((b) => `- ${b.text}`) : ['- keine']), '');
  if (scope.iocs) lines.push('## IoCs', ...(iocs.length ? iocs.map((i) => `- [${i.type}] ${i.value}${i.reputation ? ` (${i.reputation})` : ''}`) : ['- keine']), '');
  if (scope.entities) lines.push('## Entities', ...(entities.length ? entities.map((e) => `- [${e.kind}] ${e.value}`) : ['- keine']), '');
  if (scope.timeline) lines.push('## Timeline', ...((tl && tl.events.length) ? tl.events.map((e) => `- ${e.time} · ${e.srcIp ?? '?'} → ${e.dstIp ?? '?'} (${e.protocol ?? '?'})`) : ['- keine']), '');
  if (scope.decision) lines.push('## Decision', t.decision || '—', '', '## Recommendation', t.recommendation || '—', '');
  if (meta.watermark) lines.push('', `> ${meta.watermark}`);
  return lines.join('\n').trimEnd();
}

export function estimateBytes(text: string): number {
  return new Blob([text]).size;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}
