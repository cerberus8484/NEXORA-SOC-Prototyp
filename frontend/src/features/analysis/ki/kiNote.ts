/**
 * Reine Notiz-Helfer für die Analyse-Ansicht.
 *
 * `appendNote` hängt einen Textblock mit klarer, auditierbarer Herkunftszeile an
 * vorhandene Ticket-Notizen an. `buildKiNoteText` formt die KI-Analyse
 * (Verdict + Assessment) in den Notiz-Text — beides ohne Seiteneffekte, gut testbar.
 */

export interface NoteMeta {
  /** Herkunfts-Label (z. B. "KI-Einschätzung übernommen"). */
  label: string;
  /** Zeitpunkt der Übernahme. */
  at: Date;
}

/** Hängt `addition` an `existing` an. Leere Notizen → kein führender Trenner. */
export function appendNote(existing: string, addition: string, meta: NoteMeta): string {
  const body = addition.trim();
  if (!body) return existing;
  const stamp = meta.at.toISOString().slice(0, 16).replace('T', ' ');
  const block = `— ${meta.label} (${stamp}) —\n${body}`;
  const base = existing.trim();
  return base ? `${base}\n\n${block}` : block;
}

/** Baut den Notiz-Text aus einer KI-Analyse (Verdict-Zeile + Assessment). */
export function buildKiNoteText(a: { verdict?: string | null; assessment?: string | null }): string {
  const verdict = a.verdict ? `Verdict: ${a.verdict}` : '';
  const assessment = (a.assessment ?? '').trim();
  return [verdict, assessment].filter(Boolean).join('\n');
}
