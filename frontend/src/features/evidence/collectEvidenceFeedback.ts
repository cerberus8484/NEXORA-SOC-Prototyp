// Reine Logik: übersetzt die collect-evidence-Antwort (POST /tickets/:id/collect-evidence)
// in eine benutzerfreundliche Rückmeldung. UI-frei und damit testbar.

import type { CollectEvidenceResponse } from '../tickets/ticketApi';

export type FeedbackTone = 'success' | 'warning' | 'error';

export interface CollectEvidenceFeedback {
  tone: FeedbackTone;
  message: string;
}

// Bekannte Grund-Codes des Backends → deutsche Klartext-Meldung.
const REASON_MESSAGES: Record<string, { tone: FeedbackTone; message: string }> = {
  no_agent_id: {
    tone: 'warning',
    message: 'Kein Wazuh-Agent für dieses Ticket gefunden — Artefakte können nicht gesammelt werden.',
  },
  wazuh_disabled: {
    tone: 'warning',
    message: 'Die Wazuh-API ist nicht konfiguriert — Endpoint-Sammlung ist deaktiviert.',
  },
  wazuh_unavailable: {
    tone: 'error',
    message: 'Wazuh ist derzeit nicht erreichbar — bitte später erneut versuchen.',
  },
  ticket_not_found: {
    tone: 'error',
    message: 'Ticket wurde nicht gefunden.',
  },
};

/**
 * Wandelt die Server-Antwort in eine Anzeige-Rückmeldung um.
 * ok:true  → Erfolg mit Anzahl gesammelter Artefakte.
 * ok:false → bekannter Grund-Code oder generischer Fallback.
 */
export function collectEvidenceFeedback(res: CollectEvidenceResponse): CollectEvidenceFeedback {
  if (res.ok) {
    const n = typeof res.collected === 'number' ? res.collected : 0;
    return {
      tone: 'success',
      message: n > 0
        ? `${n} Endpoint-Artefakt${n === 1 ? '' : 'e'} gesammelt und am Ticket gespeichert.`
        : 'Endpoint-Sammlung abgeschlossen — keine neuen Artefakte gefunden.',
    };
  }

  const known = res.reason ? REASON_MESSAGES[res.reason] : undefined;
  if (known) return known;

  return { tone: 'warning', message: 'Endpoint-Sammlung nicht möglich.' };
}

/** Übersetzt einen geworfenen Fehler (Netzwerk/HTTP) in eine Fehler-Rückmeldung. */
export function collectEvidenceErrorFeedback(err: unknown): CollectEvidenceFeedback {
  const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
  return { tone: 'error', message: `Sammlung fehlgeschlagen: ${message}` };
}
