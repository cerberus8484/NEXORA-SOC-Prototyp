// Einheitlicher Text-Renderer für Reports (P_REPORTS_2).
// EIN ReportDoc ist die Single Source — Text/Print/PDF leiten alle daraus ab,
// keine getrennte Mapping-Logik mehr. Rein (keine DOM-/API-Zugriffe) → testbar.
import type { Ticket } from '../../lib/types';
import type { SummaryBullet, EntityItem } from './deckModel';
import type { TicketTimeline } from './analysisModel';
import { buildIncidentReport, type ReportDoc } from './reportModel';

/** Zeilenumbruch bei max. Breite — Wörter werden nicht getrennt. */
export function wrapLine(text: string, maxW: number): string[] {
  if (text.length <= maxW) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= maxW) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

/**
 * Rendert ein ReportDoc als Plain-Text (Copy + Monospace-PDF). Gleiche fachliche
 * Reihenfolge/Begriffe wie HTML-Preview und PDF; Quellen (Traceability) bleiben sichtbar.
 */
export function renderReportText(doc: ReportDoc): string {
  const out: string[] = [doc.title.toUpperCase()];
  if (doc.subtitle) out.push(doc.subtitle);
  out.push('');
  for (const s of doc.sections) {
    out.push(`== ${s.heading} ==`);
    for (const f of s.fields ?? []) out.push(`${f.label}: ${f.value}`);
    for (const p of s.paragraphs ?? []) out.push(p);
    for (const it of s.items ?? []) out.push(`- ${it.text}${it.source ? `  (Quelle: ${it.source})` : ''}`);
    for (const b of s.bullets ?? []) out.push(`- ${b}`);
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

/** Incident-Report als Text — leitet vom gemeinsamen ReportDoc ab (keine Doppel-Logik). */
export function buildReportText(
  t: Ticket,
  bullets: SummaryBullet[],
  entities: EntityItem[],
  tl: TicketTimeline | null,
): string {
  return renderReportText(buildIncidentReport({ ticket: t, summary: bullets, entities, timeline: tl }));
}
