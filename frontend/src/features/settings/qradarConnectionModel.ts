// Pure Logik der QRadar-Verbindungs-Verwaltung (Layer 2) — ohne React, testbar.
// Token wird nur gesendet, wenn eingegeben (leer = unverändert; spiegelt den Server).

import i18n from '../../i18n';

export type QradarSource = 'db' | 'env' | 'none';

/** Maskierte Serversicht (GET /qradar/connection) — nie der Token. */
export interface QradarMasked {
  baseUrl: string;
  tokenSet: boolean;
  source: QradarSource;
}

export interface QradarForm {
  baseUrl: string;
  token: string;   // leer = gespeicherten behalten
}

export interface QradarPatch {
  baseUrl: string;
  token: string;
}

export function isHttpsUrl(url: string): boolean {
  return /^https:\/\/.+/i.test(url);
}

export function qradarFormFromMasked(masked: QradarMasked): QradarForm {
  return { baseUrl: masked.baseUrl, token: '' };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildQradarPatch(form: QradarForm, masked?: QradarMasked): QradarPatch | null {
  const baseUrl = form.baseUrl.trim();
  const token = form.token;
  if (baseUrl === '') {
    return masked?.source === 'db' ? { baseUrl: '', token: '' } : null;
  }
  const changed = !masked || baseUrl !== masked.baseUrl || token !== '';
  return changed ? { baseUrl, token } : null;
}

/** Client-Vor-Validierung; '' = ok. */
export function qradarConnError(form: QradarForm, masked: QradarMasked): string {
  const baseUrl = form.baseUrl.trim();
  if (baseUrl === '') return '';
  if (!isHttpsUrl(baseUrl)) return i18n.t('settings.qradarUrlMustHttps');
  const willWrite = buildQradarPatch(form, masked) !== null;
  if (!willWrite) return '';
  const hasStoredToken = masked.source === 'db' && masked.tokenSet;
  if (form.token === '' && !hasStoredToken) return i18n.t('label.apiTokenRequiredStoredEncrypted');
  return '';
}

export function qradarSourceLabel(source: QradarSource): string {
  if (source === 'db') return i18n.t('label.managedInterfaceEncryptedDatabase');
  if (source === 'env') return 'Systemwert';
  return i18n.t('text.notConfigured');
}
