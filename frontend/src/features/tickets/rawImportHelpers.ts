/**
 * rawImportHelpers.ts — Mapper: ImportRawResponse → Editor-Formfelder + Payloads.
 *
 * Reine Funktionen (keine Seiteneffekte, keine API-Calls) → vollständig testbar.
 *
 * Regeln:
 * - rawImportToFormPatch   → flacher Record<string,string> für setForm()-Patch
 * - rawImportToPayloads    → TicketPayloadItem[] für setPayloads()-Anhang
 *
 * Quell-Mapping (Smart-Parser liefert evidence.payload als Record<string,unknown>):
 *   type IP   → fields.ip     → patch.srcIp
 *   type Hash → fields.hashval→ patch.hash
 *   iocs[]    → patch.iocs    (newline-getrennte Zeile pro IOC-Wert)
 */

import type { ImportRawResponse } from './ticketApi';
import type { TicketPayloadItem } from './payloadSchema';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractPayloadFields(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) return {};
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'string' && val.trim()) {
      fields[key] = val;
    }
  }
  return fields;
}

/**
 * Mappt die Smart-Parser-Antwort auf ein flaches Form-Patch-Objekt.
 * Nur befüllte Felder werden zurückgegeben — leere IOC-Listen erzeugen kein
 * iocs-Feld, damit vorhandene Ticket-Daten nicht überschrieben werden.
 */
export function rawImportToFormPatch(resp: ImportRawResponse): Record<string, string> {
  const patch: Record<string, string> = {};
  const { type, evidence, iocs } = resp.data;

  // Payload-Felder aus evidence.payload extrahieren
  const payload = isRecord(evidence) ? (evidence as Record<string, unknown>).payload : undefined;
  const fields = extractPayloadFields(payload);

  // Typ-spezifische Feldzuordnungen
  if (type === 'IP' && fields.ip) {
    patch.srcIp = fields.ip;
  }
  if (type === 'Hash' && fields.hashval) {
    patch.hash = fields.hashval;
  }

  // IOC-Liste → iocs-Formfeld (newline-getrennt)
  if (Array.isArray(iocs) && iocs.length > 0) {
    const lines = iocs
      .map((ioc: { type: string; value: string }) => ioc.value)
      .filter(Boolean)
      .join('\n');
    if (lines) patch.iocs = lines;
  }

  return patch;
}

/**
 * Erzeugt TicketPayloadItems aus der Smart-Parser-Antwort.
 * Gibt ein leeres Array zurück wenn keine strukturierten Payload-Felder
 * vorhanden sind (evidence.payload fehlt oder ist leer).
 */
export function rawImportToPayloads(resp: ImportRawResponse, raw: string): TicketPayloadItem[] {
  const { type, evidence } = resp.data;
  const payload = isRecord(evidence) ? (evidence as Record<string, unknown>).payload : undefined;
  const fields = extractPayloadFields(payload);

  if (Object.keys(fields).length === 0) return [];

  return [{
    id: crypto.randomUUID(),
    type,
    raw,
    fields,
    createdAt: new Date().toISOString(),
  }];
}
