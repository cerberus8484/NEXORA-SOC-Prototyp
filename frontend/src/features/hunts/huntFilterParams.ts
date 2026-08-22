// Liest/schreibt den Hunt-Listen-Filter aus/in URL-Query-Parametern.
// Reine Logik (URLSearchParams ist in jsdom verfügbar) → testbar.

export interface HuntListFilter {
  status: string; // '' = alle
  type: string;   // huntType / Katalog-Key, '' = alle
  q: string;      // Freitext-Suche
}

export const EMPTY_HUNT_FILTER: HuntListFilter = { status: '', type: '', q: '' };

const VALID_STATUS = ['active', 'completed', 'failed', 'planned', 'cancelled'];

// Aus URLSearchParams einen Filter ableiten. Unbekannte Status werden verworfen.
export function filterFromParams(params: URLSearchParams): HuntListFilter {
  const status = params.get('status') ?? '';
  return {
    status: VALID_STATUS.includes(status) ? status : '',
    type: params.get('type') ?? '',
    q: params.get('q') ?? '',
  };
}

// Filter in ein Plain-Objekt für setSearchParams umwandeln.
// Leere Werte werden weggelassen → saubere URL.
export function filterToParams(f: HuntListFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status) out.status = f.status;
  if (f.type) out.type = f.type;
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}
