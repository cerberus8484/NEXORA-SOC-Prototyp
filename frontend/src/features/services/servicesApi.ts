import { api } from '../../lib/apiClient';
import type { MaskedConnection, SectionPatch } from './wazuhConnectionModel';

// API-Anbindung der Services-Control-Seite.
//   - list(): liest den Registry-Katalog (admin-only, GET /services).
//   - restartWazuhManager(): RUFT den bestehenden, gegateten Restart-Endpoint
//     (POST /wazuh/manager/restart) — hier wird KEINE Restart-Logik dupliziert.

/** Restart-Fähigkeit eines Dienstes inkl. ehrlicher Begründung, wenn deaktiviert. */
export interface ServiceRestart {
  supported: boolean;
  enabled: boolean;
  /** Grund, warum ein Restart aktuell nicht möglich ist (null wenn möglich). */
  disabledReason: string | null;
}

/** Herkunft der Scharfschaltung: per ENV, per UI, oder gar nicht (null). */
export type ArmSource = 'env' | 'ui' | null;

export interface ServiceConnectionState {
  configured: boolean;
  apiConfigured: boolean;
  indexerConfigured: boolean;
}

/** Ein steuerbarer Infrastruktur-Dienst aus der Registry. */
export interface ManagedService {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Ist der Restart scharfgeschaltet (ENV-Fallback ODER per UI)? */
  armed: boolean;
  /** Woher stammt die Scharfschaltung (env/ui) oder null, wenn nicht scharf. */
  armSource: ArmSource;
  /** Effektiver Verbindungszustand getrennt nach API und Indexer. */
  connection: ServiceConnectionState;
  restart: ServiceRestart;
}

interface ServicesResponse {
  data: ManagedService[];
}

/** Antwort der arm/disarm-Endpoints: der neue Scharfschalt-Zustand. */
export interface ArmState {
  armed: boolean;
  armSource: ArmSource;
}

interface ArmResponse {
  data: ArmState;
}

/** Redigierte Antwort des Restart-Endpoints (keine rohen API-Metadaten). */
export interface RestartResult {
  ok: boolean;
  restarted: boolean;
  confirmed: boolean;
}

export const servicesApi = {
  /** Registry steuerbarer Dienste (admin-only). */
  list: (opts?: { signal?: AbortSignal }) =>
    api.get<ServicesResponse>('/services', undefined, opts),

  /**
   * Wazuh-Manager neu starten — nutzt den bestehenden gegateten Endpoint.
   * Der Server validiert die Config vorab und schreibt ein Audit; Fehler kommen
   * als HTTP-Status (403 disabled / 409 not_configured / 422 invalid_config / 5xx).
   */
  restartWazuhManager: () =>
    api.post<RestartResult>('/wazuh/manager/restart', {}),

  /**
   * Wazuh-Manager-Restart per UI scharfschalten (admin, Passwort-Step-up).
   * Der Server verifiziert das Passwort des aktuellen Users; Fehler kommen als
   * HTTP-Status (400 fehlend / 403 ungültig). Gibt den neuen Arm-Zustand zurück.
   */
  arm: (password: string) =>
    api.post<ArmResponse>('/services/wazuh-manager/arm', { password }),

  /** Scharfschaltung wieder aufheben (admin; kein Passwort — sichere Richtung). */
  disarm: () =>
    api.post<ArmResponse>('/services/wazuh-manager/disarm', {}),

  // ── Wazuh-Verbindung (Layer 2: UI-verwaltet, verschlüsselt in DB) ────────────

  /** Maskierte Verbindungs-Sicht (admin-only) — enthält NIE Passwörter. */
  getWazuhConnection: (opts?: { signal?: AbortSignal }) =>
    api.get<WazuhConnectionResponse>('/services/wazuh-connection', undefined, opts),

  /**
   * Verbindung speichern (admin + Passwort-Step-up). Sektion weglassen = unverändert;
   * Passwort leer = gespeichertes behalten; URL leer = Sektion löschen (→ ENV).
   * Fehler kommen als HTTP-Status (400 Validierung / 403 Passwort ungültig).
   */
  saveWazuhConnection: (payload: { password: string; api?: SectionPatch; indexer?: SectionPatch }) =>
    api.put<WazuhConnectionResponse>('/services/wazuh-connection', payload),

  /**
   * Verbindungstest ohne Speichern. Leere Felder fallen serverseitig auf die
   * effektive Verbindung zurück (so ist auch das maskierte Passwort mittestbar).
   * Ein fehlgeschlagener Ping ist ein ERWARTETES Ergebnis ({ ok:false, error }).
   */
  testWazuhConnection: (payload: { target: 'api' | 'indexer'; url?: string; user?: string; password?: string }) =>
    api.post<ConnectionTestResponse>('/services/wazuh-connection/test', payload),
};

interface WazuhConnectionResponse {
  data: MaskedConnection;
}

/** Ergebnis des Verbindungstests — ehrlich inkl. Fehlergrund. */
export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface ConnectionTestResponse {
  data: ConnectionTestResult;
}
