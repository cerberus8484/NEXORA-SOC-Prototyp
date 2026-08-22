// Pure Logik der Wazuh-Verbindungs-Verwaltung (Layer 2) — ohne React, gut testbar.
//
// Semantik (spiegelt den Server):
//   - Sektion (api|indexer) wird nur gesendet, wenn sie sich geändert hat (kein No-op-Write),
//   - leeres Passwort im Patch = Server behält das gespeicherte Passwort,
//   - URL geleert bei DB-verwalteter Sektion = Sektion löschen → zurück zu ENV,
//   - nur interne Ziele (localhost/RFC-1918) — SSRF-Schutz, serverseitig erzwungen.

/** Herkunft der effektiven Verbindung: UI-verwaltet (DB), ENV-Fallback oder gar nicht. */
export type ConnectionSource = 'db' | 'env' | 'none';

/** Maskierte Sektion vom Server — enthält NIE ein Passwort. */
export interface MaskedSection {
  url: string;
  user: string;
  passwordSet: boolean;
  source: ConnectionSource;
}

/** Maskierte Gesamtsicht (GET /services/wazuh-connection). */
export interface MaskedConnection {
  api: MaskedSection;
  indexer: MaskedSection;
}

/** Formularzustand einer Sektion; Passwort leer = unverändert lassen. */
export interface SectionForm {
  url: string;
  user: string;
  password: string;
}

/** Patch, wie ihn PUT /services/wazuh-connection pro Sektion erwartet. */
export interface SectionPatch {
  url: string;
  user: string;
  password: string;
}

// Spiegel der Server-Allowlist (internalUrlAllowlist.js) — nur Vor-Validierung,
// die Durchsetzung bleibt serverseitig.
const INTERNAL_URL_ALLOWLIST = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d{1,5})?(\/.*)?$/;

export function isInternalHttpUrl(url: string): boolean {
  return INTERNAL_URL_ALLOWLIST.test(url);
}

/** Formular vom maskierten Serverstand vorbefüllen (Passwort bewusst leer). */
export function sectionFormFromMasked(masked: MaskedSection): SectionForm {
  return { url: masked.url, user: masked.user, password: '' };
}

/**
 * Patch für eine Sektion bauen — oder undefined, wenn nichts zu senden ist.
 * Löschen (url leer) wird nur gesendet, wenn die Sektion aktuell DB-verwaltet ist.
 */
export function sectionPatch(formState: SectionForm, masked: MaskedSection): SectionPatch | undefined {
  const url = formState.url.trim();
  const user = formState.user.trim();
  const password = formState.password;

  if (url === '') {
    // Nur eine DB-verwaltete Sektion kann gelöscht werden (→ ENV-Fallback).
    return masked.source === 'db' ? { url: '', user: '', password: '' } : undefined;
  }
  const isChanged = url !== masked.url || user !== masked.user || password !== '';
  return isChanged ? { url, user, password } : undefined;
}

/**
 * Client-Vor-Validierung einer Sektion; '' = ok. Verhindert vor allem den Fall,
 * dass eine ENV-Quelle ohne neues Passwort in die DB überführt wird — das
 * ENV-Passwort lässt sich nicht kopieren, die Sektion wäre unvollständig.
 */
export function sectionError(formState: SectionForm, masked: MaskedSection): string {
  const url = formState.url.trim();
  if (url === '') return '';
  if (!isInternalHttpUrl(url)) {
    return 'URL muss auf einen internen Host zeigen (localhost oder RFC-1918).';
  }
  const willWrite = sectionPatch(formState, masked) !== undefined;
  if (!willWrite) return '';
  if (formState.user.trim() === '') return 'Benutzer erforderlich.';
  const hasStoredPassword = masked.source === 'db' && masked.passwordSet;
  if (formState.password === '' && !hasStoredPassword) {
    return 'Passwort erforderlich (wird verschlüsselt gespeichert).';
  }
  return '';
}

/** Ehrliches Herkunfts-Label für die UI (ENV-only sichtbar machen — Projekt-Regel). */
export function sourceLabel(source: ConnectionSource): string {
  if (source === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (source === 'env') return 'Systemwert';
  return 'Nicht konfiguriert';
}
