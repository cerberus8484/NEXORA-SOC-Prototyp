// Pure Logik der OTRS/Znuny-Outbound-Verbindungs-Verwaltung (Layer 2) — ohne React.
// OTRS-Passwort wird nur gesendet, wenn eingegeben (leer = unverändert).

export type OtrsSource = 'db' | 'env' | 'none';

export interface OtrsMasked {
  baseUrl: string;
  username: string;
  queue: string;
  webService: string;
  operation: string;
  passwordSet: boolean;
  source: OtrsSource;
}

export interface OtrsForm {
  baseUrl: string;
  username: string;
  otrsPassword: string;   // leer = gespeichertes behalten
  queue: string;
  webService: string;
  operation: string;
}

export interface OtrsPatch {
  baseUrl: string;
  username: string;
  otrsPassword: string;
  queue: string;
  webService: string;
  operation: string;
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url);
}

export function otrsFormFromMasked(m: OtrsMasked): OtrsForm {
  return {
    baseUrl: m.baseUrl, username: m.username, otrsPassword: '',
    queue: m.queue, webService: m.webService, operation: m.operation,
  };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildOtrsPatch(form: OtrsForm, masked?: OtrsMasked): OtrsPatch | null {
  const baseUrl = form.baseUrl.trim();
  const username = form.username.trim();
  const queue = form.queue.trim();
  const webService = form.webService.trim();
  const operation = form.operation.trim();
  if (baseUrl === '') {
    return masked?.source === 'db'
      ? { baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' }
      : null;
  }
  const changed = !masked
    || baseUrl !== masked.baseUrl
    || username !== masked.username
    || form.otrsPassword !== ''
    || queue !== masked.queue
    || webService !== masked.webService
    || operation !== masked.operation;
  return changed ? { baseUrl, username, otrsPassword: form.otrsPassword, queue, webService, operation } : null;
}

/** Client-Vor-Validierung; '' = ok. */
export function otrsConnError(form: OtrsForm, masked: OtrsMasked): string {
  const baseUrl = form.baseUrl.trim();
  if (baseUrl === '') return '';
  if (!isHttpUrl(baseUrl)) return 'OTRS-URL muss http(s) sein.';
  const willWrite = buildOtrsPatch(form, masked) !== null;
  if (!willWrite) return '';
  if (form.username.trim() === '') return 'Benutzer erforderlich.';
  const hasStoredPassword = masked.source === 'db' && masked.passwordSet;
  if (form.otrsPassword === '' && !hasStoredPassword) return 'Passwort erforderlich (wird verschlüsselt gespeichert).';
  return '';
}

export function otrsSourceLabel(source: OtrsSource): string {
  if (source === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (source === 'env') return 'Systemwert';
  return 'Nicht konfiguriert';
}
