import { ApiError } from '../../lib/apiClient';
import type { RestartResult } from './servicesApi';
import i18n from '../../i18n';

// Reine Abbildung von Restart-Ergebnis/-Fehler auf eine ehrliche Nutzer-Meldung.
// Kein Fake-Erfolg: ein ausgelöster, aber unbestätigter Neustart wird als solcher
// gezeigt; Server-Fehler werden auf spezifische, aber nicht-leakende Texte gemappt.
// Getrennt von der Komponente → gut testbar (Vitest).

export type FeedbackTone = 'success' | 'warning' | 'error';

export interface RestartFeedback {
  tone: FeedbackTone;
  text: string;
}

/** Ehrliche Bewertung der (redigierten) Erfolgsantwort des Restart-Endpoints. */
export function restartResultMessage(result: RestartResult): RestartFeedback {
  if (!result.ok || !result.restarted) {
    return { tone: 'error', text: i18n.t('ui.restartCouldNotTriggered') };
  }
  if (!result.confirmed) {
    return {
      tone: 'warning',
      text: i18n.t('ui.restartTriggeredButNotYet') + ' '
        + i18n.t('ui.checkStatusWazuhDashboardShortly'),
    };
  }
  return { tone: 'success', text: i18n.t('ui.wazuhManagerRestartedRestartConfirmed') };
}

/**
 * Bildet einen Restart-Fehler auf eine spezifische, ehrliche Meldung ab.
 * Nutzt nur den HTTP-Status (ApiError.status) — niemals die rohe Server-/
 * Fehlermeldung, damit keine internen Details/Secrets nach außen gelangen.
 */
export function restartErrorMessage(err: unknown): RestartFeedback {
  const status = err instanceof ApiError ? err.status : 0;

  switch (status) {
    case 403:
      return {
        tone: 'error',
        text: i18n.t('ui.restartDisabledServerEnableSet') + ' '
          + i18n.t('ui.wazuhManagerRestartEnabledTrue'),
      };
    case 409:
      return { tone: 'error', text: i18n.t('ui.wazuhApiNotConfiguredRestart') };
    case 422:
      return {
        tone: 'error',
        text: i18n.t('ui.wazuhConfigurationNotValidRestart') + ' '
          + i18n.t('ui.protectsAgainstManagerBrokenRuleset'),
      };
    case 429:
      return { tone: 'error', text: i18n.t('ui.tooManyRestartRequestsPlease') };
    default:
      return { tone: 'error', text: i18n.t('services.wazuhRestartFailed') };
  }
}
