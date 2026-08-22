// apiWebhooksApi — API-Info-Endpunkt + reine Hilfsfunktionen
//
// GET /integrations/api-info → { rateLimit, webhookReceivers }
//
// SICHERHEITS-INVARIANTE:
//   WebhookReceiver enthält NIEMALS ein Secret-Feld.
//   hmacConfigured ist IMMER nur boolean — kein Secret-Wert.

import { api } from '../../lib/apiClient';

// ── Typen ─────────────────────────────────────────────────────────────────────

export interface RateLimit {
  max:        number;
  windowMs:   number;
  webhookMax: number;
}

/**
 * Eingehender Webhook-Empfänger.
 *
 * SICHERHEITSREGEL: Kein Feld secret / key / password / token / hmacSecret.
 * hmacConfigured ist IMMER boolean — nur ob ein Secret konfiguriert ist, NICHT der Wert.
 */
export interface WebhookReceiver {
  source:         string;
  path:           string;
  hmacConfigured: boolean;
}

export interface ApiInfoData {
  rateLimit:        RateLimit;
  webhookReceivers: WebhookReceiver[];
  /** Gibt an ob Personal Access Tokens (PAT) serverseitig aktiviert sind (API_TOKENS_ENABLED). */
  tokensEnabled?:   boolean;
}

interface ApiInfoEnvelope extends ApiInfoData {
  requestId?: string;
}

// ── API-Funktion ──────────────────────────────────────────────────────────────

/** Holt API-Info vom Backend (admin-only). */
export function getApiInfo(): Promise<ApiInfoData> {
  return api.get<ApiInfoEnvelope>('/integrations/api-info').then(({ requestId: _id, ...rest }) => rest as ApiInfoData);
}

// ── Reine Hilfsfunktionen (testbar ohne DOM/API) ──────────────────────────────

/**
 * Formatiert windowMs in lesbare Zeitangabe (Deutsch).
 * Beispiel: 60000 → "1 Minute", 30000 → "30 Sekunden"
 */
export function formatWindowMs(windowMs: number): string {
  const seconds = windowMs / 1000;
  const minutes = seconds / 60;

  if (minutes >= 1) {
    const m = Math.round(minutes);
    return m === 1 ? '1 Minute' : `${m} Minuten`;
  }
  return `${Math.round(seconds)} Sekunden`;
}

/**
 * Formatiert max requests mit Fenster-Zeitraum.
 * Beispiel: (200, 60000) → "200 Requests / Minute"
 *           (500, 30000) → "500 Requests / 30 Sekunden"
 *
 * Bei genau 1 Zeiteinheit wird der Zahlenpräfix im kombinierten String weggelassen.
 */
export function formatMaxRequests(max: number, windowMs: number): string {
  const window = formatWindowMs(windowMs)
    .replace(/^1 Minute$/, 'Minute')
    .replace(/^1 Sekunden$/, 'Sekunde')
    .replace(/^1 Minuten$/, 'Minute');
  return `${max} Requests / ${window}`;
}

/**
 * Normalisiert eine API-Basis-URL: entfernt trailing slash.
 */
export function buildBaseUrl(base: string): string {
  return base.replace(/\/$/, '');
}
