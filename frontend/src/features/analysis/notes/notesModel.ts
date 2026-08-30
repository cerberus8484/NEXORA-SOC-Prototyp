// Reine, testbare Notiz-Logik. Es gibt KEIN strukturiertes Notes-Backend — Notizen leben im
// einzelnen ticket.notes-Textfeld. Hier wird eine Notiz als gut lesbarer, parsbarer Block
// serialisiert und zurückgelesen. Rückwärtskompatibel mit bestehenden „Customer Note"-/
// „Case Note"-Blöcken und reinem Freitext. KEINE erfundenen Autoren/Typen — nur was gespeichert ist.

export type NoteType = 'triage' | 'investigation' | 'internal' | 'customer' | 'note';
export interface NoteEntry {
  id: string;
  type: NoteType;
  author?: string;
  at?: string;
  tags: string[];
  body: string;
}

const TYPES: NoteType[] = ['triage', 'investigation', 'internal', 'customer', 'note'];
const clean = (v?: string): string | undefined => { const s = (v ?? '').trim(); return s && s !== '—' ? s : undefined; };
const normType = (v?: string): NoteType => { const x = (v || '').toLowerCase().trim() as NoteType; return TYPES.includes(x) ? x : 'note'; };
const parseTags = (v?: string): string[] => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean);

/** Serialisiert eine Notiz als lesbaren Block: „--- NOTE | type | author | isoTime | tags ---\nbody". */
export function serializeNote(e: { type: NoteType; author?: string; at?: string; tags?: string[]; body: string }): string {
  const header = `--- NOTE | ${e.type} | ${e.author || '—'} | ${e.at || ''} | ${(e.tags || []).join(', ')} ---`;
  return `${header}\n${e.body.trim()}`;
}

/** Hängt eine neue Notiz an das bestehende notes-Feld an (zwei Leerzeilen Abstand). */
export function appendNote(raw: string, e: { type: NoteType; author?: string; at?: string; tags?: string[]; body: string }): string {
  const base = (raw || '').trimEnd();
  const block = serializeNote(e);
  return base ? `${base}\n\n${block}` : block;
}

/** Liest das notes-Feld in eine Liste von Notizen (Speicher-Reihenfolge: älteste zuerst). */
export function parseNotes(raw: string): NoteEntry[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];

  const headerRe = /^--- (?:NOTE \| ([a-z]+) \| ([^|]*?) \| ([^|]*?) \| (.*?)|Customer Note \((.*?)\)|Case Note \((.*?)\)) ---$/gm;
  const heads: { index: number; len: number; type: NoteType; author?: string; at?: string; tags: string[] }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    if (m[1] !== undefined) {
      heads.push({ index: m.index, len: m[0].length, type: normType(m[1]), author: clean(m[2]), at: clean(m[3]), tags: parseTags(m[4]) });
    } else if (m[5] !== undefined) {
      heads.push({ index: m.index, len: m[0].length, type: 'customer', at: clean(m[5]), tags: [] });
    } else {
      heads.push({ index: m.index, len: m[0].length, type: 'note', at: clean(m[6]), tags: [] });
    }
  }

  const entries: NoteEntry[] = [];
  const firstIdx = heads.length ? heads[0].index : text.length;
  const lead = text.slice(0, firstIdx).trim();
  if (lead) entries.push({ id: 'note-lead', type: 'note', tags: [], body: lead });
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const bodyStart = h.index + h.len;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].index : text.length;
    entries.push({ id: `note-${i}`, type: h.type, author: h.author, at: h.at, tags: h.tags, body: text.slice(bodyStart, bodyEnd).trim() });
  }
  return entries;
}

/** Kurzvorschau (erste Zeile, gekürzt) für die Recent-Notes-Tabelle. */
export function notePreview(body: string, max = 120): string {
  const firstLine = (body || '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}
