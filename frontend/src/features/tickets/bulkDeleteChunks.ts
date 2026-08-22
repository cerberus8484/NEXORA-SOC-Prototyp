// Reine Chunk-/Merge-Logik für die Sammel-Löschung — testbar ohne DOM.
// Hintergrund: Das Backend cappt POST /tickets/bulk-delete auf 100 IDs pro Request.
// Bei großer (z. B. „alle gefilterten") Auswahl muss der Client die IDs in Blöcke
// zu höchstens 100 zerlegen und sequenziell senden, dann die Teilergebnisse
// ehrlich zu einem Gesamtergebnis zusammenführen.

import type { BulkDeleteResult } from './bulkDeleteModel';

/** Maximale IDs pro bulk-delete-Request (Backend-Cap). */
export const BULK_DELETE_CHUNK_SIZE = 100;

/**
 * Zerlegt eine ID-Liste in Blöcke zu höchstens `size` Einträgen (Reihenfolge bleibt erhalten).
 * Ein nicht-positives `size` wird als „ein Block" behandelt — schützt vor einer Endlosschleife.
 */
export function chunkIds(ids: readonly string[], size: number = BULK_DELETE_CHUNK_SIZE): string[][] {
  if (ids.length === 0) return [];
  if (size <= 0) return [ids.slice()];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/**
 * Führt die Teilergebnisse der einzelnen Chunks zu einem Gesamtergebnis zusammen.
 * Summiert requested/deleted/missing und hängt alle deletedIds in Reihenfolge aneinander.
 */
export function mergeBulkResults(results: readonly BulkDeleteResult[]): BulkDeleteResult {
  return results.reduce<BulkDeleteResult>(
    (acc, r) => ({
      requested: acc.requested + r.requested,
      deleted: acc.deleted + r.deleted,
      missing: acc.missing + r.missing,
      deletedIds: [...acc.deletedIds, ...r.deletedIds],
    }),
    { requested: 0, deleted: 0, missing: 0, deletedIds: [] },
  );
}
