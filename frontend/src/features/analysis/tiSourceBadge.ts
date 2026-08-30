// Ehrliche Darstellung der TI-Quelle: ist kein VirusTotal/AbuseIPDB-Key gesetzt,
// liefert das Backend Mock-Verdicts (source='mock'). Der Analyst muss sehen, dass
// kein echter Provider dranhängt — sonst wirken Beispielwerte wie echte Intel.
import type { Tone } from '../../components/ui';
import i18n from '../../i18n';

export interface TiSourceBadge {
  isMock: boolean;
  tone: Tone;
  label: string;
}

/** Entscheidet Badge/Tone für die TI-Quelle. source='mock' → ehrlicher Warn-Hinweis. */
export function tiSourceBadge(source: string | undefined | null): TiSourceBadge {
  if (source === 'mock') {
    return { isMock: true, tone: 'warning', label: i18n.t('text.noThreatIntelProviderConfigured') };
  }
  return { isMock: false, tone: 'muted', label: source ?? '' };
}
