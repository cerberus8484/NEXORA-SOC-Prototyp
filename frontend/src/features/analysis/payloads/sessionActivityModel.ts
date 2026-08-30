// Reine, testbare Ableitung der Angreifer-Session-Aktivität aus ticket.payloads.
// Quelle: Dataplane-Honeypot-Tickets ([suspicious]/[confirmed]) — der Backend-Vertrag legt
// pro Eintrag { type, raw, fields:{ kind, user?, at? } } ab. `raw`/`user` sind UNTRUSTED
// Angreifer-Input: dieses Modul reicht sie nur als reine Strings weiter, die View rendert
// sie ausschließlich als Text (nie HTML, nie href auf rohe URLs).
import type { Ticket, TicketPayload } from '../../../lib/types';

/** Bekannte Session-Aktivitäts-Arten (Cowrie/Honeypot). Alles andere wird ignoriert. */
export type SessionActivityKind = 'command' | 'login' | 'download' | 'tunnel';

export interface SessionActivityRow {
  kind: SessionActivityKind;
  /** Sprechendes deutsches Label für die Typ-Badge. */
  label: string;
  /** Anzuzeigender Wert (Befehl / URL / Login-User / Tunnel-Ziel) — untrusted, nur als Text. */
  value: string;
  /** Login-User, falls vorhanden. */
  user?: string;
  /** ISO-Zeitpunkt der Aktivität, falls vorhanden. */
  at?: string;
}

const LABELS: Record<SessionActivityKind, string> = {
  command: 'Befehl',
  login: 'Login',
  download: 'Download',
  tunnel: 'Tunnel',
};

const KNOWN: ReadonlySet<string> = new Set<SessionActivityKind>(['command', 'login', 'download', 'tunnel']);

const trimmed = (v?: string | null): string => (typeof v === 'string' ? v.trim() : '');

/** Wählt den anzuzeigenden Wert je Art: login → fields.user, sonst → raw. */
function valueFor(kind: SessionActivityKind, p: TicketPayload): string {
  if (kind === 'login') return trimmed(p.fields?.user);
  return trimmed(p.raw);
}

/**
 * Leitet die chronologische Session-Aktivität aus einem Ticket ab.
 * Robust gegen fehlende/leere Felder und nicht-Array-payloads.
 * Einträge ohne bekannten kind oder ohne sinnvollen Wert werden ausgelassen.
 */
export function deriveSessionActivity(t: Ticket): SessionActivityRow[] {
  const payloads = Array.isArray(t.payloads) ? t.payloads : [];
  const rows: SessionActivityRow[] = [];
  for (const p of payloads) {
    const kind = trimmed(p?.fields?.kind);
    if (!KNOWN.has(kind)) continue;
    const k = kind as SessionActivityKind;
    const value = valueFor(k, p);
    if (!value) continue;
    const user = trimmed(p.fields?.user) || undefined;
    const at = trimmed(p.fields?.at) || undefined;
    rows.push({ kind: k, label: LABELS[k], value, user, at });
  }
  // Chronologisch aufsteigend; Einträge ohne Zeit ans Ende (stabil).
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const at = a.r.at;
      const bt = b.r.at;
      if (at && bt) return at < bt ? -1 : at > bt ? 1 : a.i - b.i;
      if (at) return -1;
      if (bt) return 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** True, wenn mindestens eine verwertbare Session-Aktivität vorhanden ist. */
export function hasSessionActivity(t: Ticket): boolean {
  return deriveSessionActivity(t).length > 0;
}
