// Pure Logik der Qdrant-Verbindungs-Verwaltung (Layer 2) — ohne React, testbar.
// API-Key ist optional (Qdrant kann ohne Auth laufen); leer = unverändert.

export type QdrantSource = 'db' | 'env' | 'none';

export interface QdrantMasked {
  url: string;
  apiKeySet: boolean;
  source: QdrantSource;
}

export interface QdrantForm {
  url: string;
  apiKey: string;   // leer = gespeicherten behalten
}

export interface QdrantPatch {
  url: string;
  apiKey: string;
}

// Spiegel der Server-Allowlist (internalUrlAllowlist.js) — nur Vor-Validierung.
const INTERNAL_URL_ALLOWLIST = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d{1,5})?(\/.*)?$/;

export function isInternalUrl(url: string): boolean {
  return INTERNAL_URL_ALLOWLIST.test(url);
}

export function qdrantFormFromMasked(masked: QdrantMasked): QdrantForm {
  return { url: masked.url, apiKey: '' };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildQdrantPatch(form: QdrantForm, masked?: QdrantMasked): QdrantPatch | null {
  const url = form.url.trim();
  const apiKey = form.apiKey;
  if (url === '') {
    return masked?.source === 'db' ? { url: '', apiKey: '' } : null;
  }
  const changed = !masked || url !== masked.url || apiKey !== '';
  return changed ? { url, apiKey } : null;
}

/** Client-Vor-Validierung; '' = ok. Key ist optional → kein Token-Zwang. */
export function qdrantConnError(form: QdrantForm, masked: QdrantMasked): string {
  const url = form.url.trim();
  if (url === '') return '';
  if (!isInternalUrl(url)) return 'Qdrant-URL muss auf einen internen Host zeigen (localhost, RFC-1918).';
  void masked;
  return '';
}

export function qdrantSourceLabel(source: QdrantSource): string {
  if (source === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (source === 'env') return 'Systemwert';
  return 'Nicht konfiguriert';
}
