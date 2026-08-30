// Reine Logik: übersetzt die collect-evidence-Antwort (POST /tickets/:id/collect-evidence)
// in eine benutzerfreundliche Rückmeldung. UI-frei und damit testbar.

import type { CollectEvidenceResponse } from '../tickets/ticketApi';
import i18n from '../../i18n';

export type FeedbackTone = 'success' | 'warning' | 'error';

export interface CollectEvidenceFeedback {
  tone: FeedbackTone;
  message: string;
}

// Bekannte Grund-Codes des Backends → deutsche Klartext-Meldung.
const REASON_MESSAGES: Record<string, { tone: FeedbackTone; message: string }> = {
  no_agent_id: {
    tone: 'warning',
    message: i18n.t('app.noWazuhAgentFoundTicket'),
  },
  wazuh_disabled: {
    tone: 'warning',
    message: i18n.t('app.wazuhApiNotConfiguredEndpoint'),
  },
  wazuh_unavailable: {
    tone: 'error',
    message: i18n.t('app.wazuhCurrentlyUnreachablePleaseTry'),
  },
  ticket_not_found: {
    tone: 'error',
    message: i18n.t('app.ticketNotFound'),
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
        ? i18n.t('evidence.artefactsCollected', { count: n })
        : i18n.t('app.endpointCollectionFinishedNoNew'),
    };
  }

  const known = res.reason ? REASON_MESSAGES[res.reason] : undefined;
  if (known) return known;

  return { tone: 'warning', message: i18n.t('app.endpointCollectionNotPossible') };
}

/** Übersetzt einen geworfenen Fehler (Netzwerk/HTTP) in eine Fehler-Rückmeldung. */
export function collectEvidenceErrorFeedback(err: unknown): CollectEvidenceFeedback {
  const message = err instanceof Error ? err.message : i18n.t('common.unknownError');
  return { tone: 'error', message: i18n.t('evidence.collectionFailed', { message }) };
}
