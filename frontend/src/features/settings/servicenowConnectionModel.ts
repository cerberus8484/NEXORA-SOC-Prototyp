// Pure Logik der ServiceNow-Outbound-Verbindungs-Verwaltung (Layer 2) — ohne React.
// ServiceNow-Passwort wird nur gesendet, wenn eingegeben (leer = unverändert).

export type ServicenowSource = 'db' | 'env' | 'none';

export interface ServicenowMasked {
  baseUrl: string;
  username: string;
  table: string;
  passwordSet: boolean;
  source: ServicenowSource;
}

export interface ServicenowForm {
  baseUrl: string;
  username: string;
  servicenowPassword: string;   // leer = gespeichertes behalten
  table: string;
}

export interface ServicenowPatch {
  baseUrl: string;
  username: string;
  servicenowPassword: string;
  table: string;
}

export function isHttpsUrl(url: string): boolean {
  return /^https:\/\/.+/i.test(url);
}

export function servicenowFormFromMasked(m: ServicenowMasked): ServicenowForm {
  return { baseUrl: m.baseUrl, username: m.username, servicenowPassword: '', table: m.table };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildServicenowPatch(form: ServicenowForm, masked?: ServicenowMasked): ServicenowPatch | null {
  const baseUrl = form.baseUrl.trim();
  const username = form.username.trim();
  const table = form.table.trim();
  if (baseUrl === '') {
    return masked?.source === 'db' ? { baseUrl: '', username: '', servicenowPassword: '', table: '' } : null;
  }
  const changed = !masked
    || baseUrl !== masked.baseUrl
    || username !== masked.username
    || form.servicenowPassword !== ''
    || table !== masked.table;
  return changed ? { baseUrl, username, servicenowPassword: form.servicenowPassword, table } : null;
}

/** Client-Vor-Validierung; '' = ok. */
export function servicenowConnError(form: ServicenowForm, masked: ServicenowMasked): string {
  const baseUrl = form.baseUrl.trim();
  if (baseUrl === '') return '';
  if (!isHttpsUrl(baseUrl)) return 'ServiceNow-URL muss https sein.';
  const willWrite = buildServicenowPatch(form, masked) !== null;
  if (!willWrite) return '';
  if (form.username.trim() === '') return 'Benutzer erforderlich.';
  const hasStoredPassword = masked.source === 'db' && masked.passwordSet;
  if (form.servicenowPassword === '' && !hasStoredPassword) return 'Passwort erforderlich (wird verschlüsselt gespeichert).';
  return '';
}

export function servicenowSourceLabel(source: ServicenowSource): string {
  if (source === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (source === 'env') return 'Systemwert';
  return 'Nicht konfiguriert';
}
