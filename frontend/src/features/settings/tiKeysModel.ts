// Pure Logik der Threat-Intel-Key-Verwaltung (Layer 2) — ohne React, testbar.
// Keys werden nur gesendet, wenn eingegeben (leer = unverändert, spiegelt den Server).

import i18n from '../../i18n';

export type TiProvider = 'virustotal' | 'abuseipdb';
export type TiKeySource = 'db' | 'env' | 'none';

/** Maskierter Key-Status vom Server (GET /settings/ti) — nie ein Key-Wert. */
export interface TiKeyStatus {
  provider: TiProvider;
  keySet: boolean;
  source: TiKeySource;
}

/** Formularzustand: pro Provider der (neu einzugebende) Key; leer = unverändert. */
export interface TiKeyForm {
  virustotal: string;
  abuseipdb: string;
}

export interface TiProviderMeta {
  provider: TiProvider;
  label: string;
  docsHint: string;
}

export const TI_PROVIDER_META: TiProviderMeta[] = [
  { provider: 'virustotal', label: 'VirusTotal', docsHint: i18n.t('text.apiKeyV3FreeTier') },
  { provider: 'abuseipdb',  label: 'AbuseIPDB',  docsHint: i18n.t('settings.apiKeyV2CheckPublic') },
];

/** Ehrliches Herkunfts-Label für die UI (ENV-only sichtbar machen — Projekt-Regel). */
export function tiSourceLabel(source: TiKeySource): string {
  if (source === 'db') return i18n.t('label.managedInterfaceEncryptedDatabase');
  if (source === 'env') return 'Systemwert';
  return i18n.t('text.notConfigured');
}

/** Save-Payload: nur eingegebene (getrimmte, nicht-leere) Keys. */
export function buildTiSavePatch(form: TiKeyForm): Partial<Record<TiProvider, string>> {
  const patch: Partial<Record<TiProvider, string>> = {};
  const vt = form.virustotal.trim();
  const ab = form.abuseipdb.trim();
  if (vt !== '') patch.virustotal = vt;
  if (ab !== '') patch.abuseipdb = ab;
  return patch;
}

/** True, wenn mindestens ein Feld einen zu speichernden Wert enthält. */
export function hasTiChanges(form: TiKeyForm): boolean {
  return form.virustotal.trim() !== '' || form.abuseipdb.trim() !== '';
}
