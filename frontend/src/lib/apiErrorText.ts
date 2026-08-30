import { ApiError } from './apiClient';
import i18n from '../i18n';

// Wandelt einen gefangenen Fehler in eine nutzerlesbare Meldung. Bevorzugt die
// strukturierten `errors` aus dem Antwort-Body (z.B. FP-Guardrail-Begründung),
// damit statt „HTTP 422" der echte Grund erscheint. Fällt sonst auf die Message
// bzw. den Fallback zurück. Rein + testbar.
export function apiErrorText(err: unknown, fallback = i18n.t('tickets.errors.action')): string {
  if (err instanceof ApiError) {
    if (err.errors && err.errors.length > 0) return err.errors.join(' · ');
    return err.message && err.message.trim() ? err.message : fallback;
  }
  if (err instanceof Error) {
    return err.message && err.message.trim() ? err.message : fallback;
  }
  return fallback;
}
