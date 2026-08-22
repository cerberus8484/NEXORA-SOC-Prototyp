// Integrations-Status + Verbindungstest — read-only Übersicht (admin-gated am Server).
//
// GET  /integrations/status   — je Integration: id, name, category, configured,
//                               endpoint (nur Host, KEIN Secret), status, testable.
// POST /integrations/:id/test — Live-Erreichbarkeitstest (nur testbare); 501 → testable:false.
//
// SICHERHEIT: die Endpoints leaken keine Keys/Passwörter — nur configured-Flag +
// Endpoint-Host. Diese Datei speichert/zeigt niemals Secrets.

import { api, ApiError } from '../../lib/apiClient';
import type { IntegrationStatus, IntegrationTestResponse } from './integrationsView';

export type { IntegrationStatus, IntegrationTestResponse } from './integrationsView';

export async function getIntegrationStatus(): Promise<IntegrationStatus[]> {
  const env = await api.get<{ data: IntegrationStatus[] }>('/integrations/status');
  return env.data;
}

/**
 * Löst den Verbindungstest aus. Ein 501 (nicht testbar) ist KEIN Fehler, sondern
 * eine ehrliche Antwort — wird als `{ testable: false }` durchgereicht, nicht geworfen.
 */
export async function testIntegration(id: string): Promise<IntegrationTestResponse> {
  try {
    return await api.post<IntegrationTestResponse>(`/integrations/${encodeURIComponent(id)}/test`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 501) {
      return { testable: false, message: err.message };
    }
    throw err;
  }
}
