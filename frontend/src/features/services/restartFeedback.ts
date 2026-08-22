import { ApiError } from '../../lib/apiClient';
import type { RestartResult } from './servicesApi';

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
    return { tone: 'error', text: 'Neustart konnte nicht ausgelöst werden.' };
  }
  if (!result.confirmed) {
    return {
      tone: 'warning',
      text: 'Neustart ausgelöst, aber vom Manager noch nicht bestätigt. '
        + 'Status in Kürze im Wazuh-Dashboard prüfen.',
    };
  }
  return { tone: 'success', text: 'Wazuh-Manager neu gestartet — Neustart bestätigt.' };
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
        text: 'Restart ist serverseitig deaktiviert. Zum Aktivieren '
          + 'WAZUH_MANAGER_RESTART_ENABLED=true setzen und den API-Dienst neu starten.',
      };
    case 409:
      return { tone: 'error', text: 'Wazuh-API ist nicht konfiguriert — Neustart nicht möglich.' };
    case 422:
      return {
        tone: 'error',
        text: 'Wazuh-Konfiguration ist nicht valide — Neustart wurde abgebrochen '
          + '(schützt vor einem Manager mit kaputtem Ruleset).',
      };
    case 429:
      return { tone: 'error', text: 'Zu viele Restart-Anfragen — bitte später erneut versuchen.' };
    default:
      return { tone: 'error', text: 'Wazuh-Manager-Neustart fehlgeschlagen.' };
  }
}
