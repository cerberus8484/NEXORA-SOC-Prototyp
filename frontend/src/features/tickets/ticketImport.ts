import type { TicketPayloadItem } from './payloadSchema';
import type { TiEntry } from './tiEntry';

/**
 * Parst eine importierte Ticket-JSON (Gegenstück zu `exportJson` im Editor).
 *
 * Robust gegen Fremd-Input: akzeptiert nur ein Objekt, übernimmt skalare
 * Felder als Strings und validiert eingebettete Payloads grob (jeder Payload
 * braucht mindestens einen `type`). Wirft bei unbrauchbarem Format.
 */
export interface TicketImportResult {
  form: Record<string, string>;
  payloads: TicketPayloadItem[];
  tiEntries: TiEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toPayload(raw: unknown): TicketPayloadItem | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || raw.type.trim() === '') return null;
  const fields: Record<string, string> = {};
  if (isRecord(raw.fields)) {
    for (const [k, v] of Object.entries(raw.fields)) {
      if (typeof v === 'string') fields[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') fields[k] = String(v);
    }
  }
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    type: raw.type,
    raw: typeof raw.raw === 'string' ? raw.raw : '',
    fields,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function toTiEntry(raw: unknown): TiEntry | null {
  if (!isRecord(raw)) return null;
  const entry: TiEntry = {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    category: str(raw.category),
    actor: str(raw.actor),
    malware: str(raw.malware),
    confidence: str(raw.confidence),
  };
  // Leere Einträge (nur ID) verwerfen.
  if (!entry.category && !entry.actor && !entry.malware && !entry.confidence) return null;
  return entry;
}

export function parseTicketImport(raw: unknown): TicketImportResult {
  if (!isRecord(raw)) {
    throw new Error('Ungültiges Ticket-Format — erwartet ein JSON-Objekt');
  }

  const form: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'payloads' || key === 'tiEntries') continue;
    if (value == null) continue;
    if (typeof value === 'string') form[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') form[key] = String(value);
    // verschachtelte Objekte/Arrays werden bewusst übersprungen
  }

  const payloads = Array.isArray(raw.payloads)
    ? raw.payloads.map(toPayload).filter((p): p is TicketPayloadItem => p !== null)
    : [];

  const tiEntries = Array.isArray(raw.tiEntries)
    ? raw.tiEntries.map(toTiEntry).filter((e): e is TiEntry => e !== null)
    : [];

  if (Object.keys(form).length === 0 && payloads.length === 0 && tiEntries.length === 0) {
    throw new Error('Keine importierbaren Ticket-Felder gefunden');
  }

  return { form, payloads, tiEntries };
}
