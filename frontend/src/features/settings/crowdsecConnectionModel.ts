// Pure Logik der CrowdSec-LAPI-Verbindungs-Verwaltung (Layer 2) — ohne React.
// LAPI-Passwort wird nur gesendet, wenn eingegeben (leer = unverändert).

import i18n from '../../i18n';

export type CrowdsecSource = 'db' | 'env' | 'none';

export interface CrowdsecMasked {
  baseUrl: string;
  machineId: string;
  passwordSet: boolean;
  tlsInsecure: boolean;
  source: CrowdsecSource;
}

export interface CrowdsecForm {
  baseUrl: string;
  machineId: string;
  lapiPassword: string;   // leer = gespeichertes behalten
  tlsInsecure: boolean;
}

export interface CrowdsecPatch {
  baseUrl: string;
  machineId: string;
  lapiPassword: string;
  tlsInsecure: boolean;
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url);
}

export function crowdsecFormFromMasked(m: CrowdsecMasked): CrowdsecForm {
  return { baseUrl: m.baseUrl, machineId: m.machineId, lapiPassword: '', tlsInsecure: m.tlsInsecure };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildCrowdsecPatch(form: CrowdsecForm, masked?: CrowdsecMasked): CrowdsecPatch | null {
  const baseUrl = form.baseUrl.trim();
  const machineId = form.machineId.trim();
  if (baseUrl === '') {
    return masked?.source === 'db' ? { baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false } : null;
  }
  const changed = !masked
    || baseUrl !== masked.baseUrl
    || machineId !== masked.machineId
    || form.lapiPassword !== ''
    || form.tlsInsecure !== masked.tlsInsecure;
  return changed ? { baseUrl, machineId, lapiPassword: form.lapiPassword, tlsInsecure: form.tlsInsecure } : null;
}

/** Client-Vor-Validierung; '' = ok. */
export function crowdsecConnError(form: CrowdsecForm, masked: CrowdsecMasked): string {
  const baseUrl = form.baseUrl.trim();
  if (baseUrl === '') return '';
  if (!isHttpUrl(baseUrl)) return i18n.t('settings.lapiUrlMustHttpS');
  const willWrite = buildCrowdsecPatch(form, masked) !== null;
  if (!willWrite) return '';
  if (form.machineId.trim() === '') return 'Machine-ID erforderlich.';
  const hasStoredPassword = masked.source === 'db' && masked.passwordSet;
  if (form.lapiPassword === '' && !hasStoredPassword) return i18n.t('ui.passwordRequiredStoredEncrypted');
  return '';
}

export function crowdsecSourceLabel(source: CrowdsecSource): string {
  if (source === 'db') return i18n.t('label.managedInterfaceEncryptedDatabase');
  if (source === 'env') return 'Systemwert';
  return i18n.t('text.notConfigured');
}
