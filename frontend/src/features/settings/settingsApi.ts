// Settings-API — Plattform-Einstellungen + KI-Einstellungen
//
// GET  /settings/platform  — alle Rollen (lesen)
// PUT  /settings/platform  — nur Admin (schreiben)
// GET  /settings/ki        — nur Admin
// PUT  /settings/ki        — nur Admin
// GET  /settings/ki/models — nur Admin

import { api } from '../../lib/apiClient';

// ── Plattform-Einstellungen ───────────────────────────────────────────────────
// Ehrlichkeits-Regel (ADR-009): Nur Keys die wir auch meinen.
// maintenanceMode wird serverseitig durchgesetzt (503 für nicht-Admins).
// betaFeatures ist reine Präferenz — keine Server-Enforce-Logik.

export interface PlatformSettings {
  platformName:    string;
  defaultView:     'dashboard' | 'tickets' | 'hunts';
  timezone:        string;
  language:        'de' | 'en';
  maintenanceMode: boolean;
  betaFeatures:    boolean;

  // Security-Keys — Phase 2 (serverseitig durchgesetzt).
  // passwordMinLength + passwordComplexity: gelten bei register / changePassword / create / resetPassword.
  // sessionMaxHours: steuert JWT expiresIn beim nächsten Login.
  passwordMinLength:  number;
  passwordComplexity: 'low' | 'medium' | 'high';
  sessionMaxHours:    number;

  // Account-Lockout — Phase 2 (serverseitig durchgesetzt).
  // lockoutMaxAttempts: 0 = deaktiviert; >0 = Konto nach N Fehlversuchen sperren.
  // lockoutMinutes: Sperrdauer in Minuten.
  lockoutMaxAttempts: number;
  lockoutMinutes:     number;

  // Passwort-Aging — Welle 2 (serverseitig durchgesetzt, 0 = deaktiviert).
  // Optional, da der Server stets Defaults liefert.
  passwordExpiryDays?:   number;
  passwordHistoryCount?: number;

  // Sitzungs-Richtlinie — Welle 2.
  maxConcurrentSessions?:    number; // serverseitig (0 = unbegrenzt)
  inactivityTimeoutMinutes?: number; // clientseitig (0 = aus)

  // Zugriffskontrolle — Welle 1 (serverseitig durchgesetzt, default aus).
  // Optional, da der Server stets Defaults liefert — hält bestehende Fixtures stabil.
  tlsEnforce?:         boolean;
  ipAllowlistEnabled?: boolean;
  ipAllowlistCidrs?:   string;

  // Org-weite MFA-Pflicht (serverseitig im Login erzwungen, default aus).
  mfaRequired?:        boolean;

  // Branding — real via platform-settings KV-Store (ADR-009: kein Fake-Persist)
  accentColor: string;
  fontFamily?: string;       // Stack-Key: 'default' | 'system' | 'serif' | 'mono'
  backgroundColor?: string;  // App-Hintergrund (--bg), Hex
  sidebarColor?: string;     // Sidebar-Fläche (--sidebar-bg), Hex
}

interface PlatformEnvelope {
  data: PlatformSettings;
}

export async function getPlatform(): Promise<PlatformSettings> {
  const env = await api.get<PlatformEnvelope>('/settings/platform');
  return env.data;
}

export async function savePlatform(settings: PlatformSettings): Promise<PlatformSettings> {
  const env = await api.put<PlatformEnvelope>('/settings/platform', settings);
  return env.data;
}

// ── KI-Einstellungen ──────────────────────────────────────────────────────────

export type LlmProviderKind = 'stub' | 'ollama' | 'anthropic' | 'openai' | 'google';

export interface KiConfig {
  ollamaBaseUrl: string;
  ollamaModel: string;
  agentLlmProvider: LlmProviderKind;
  ragEnabled: boolean;
  // Cloud-Modelle (leer = Provider-Default).
  anthropicModel?: string;
  openaiModel?: string;
  googleModel?: string;
  // Fallback-Kette + globale Modell-Parameter.
  agentFallback1?: string;
  agentFallback2?: string;
  llmTemperature?: number | string;
  llmTopP?: number | string;
  llmMaxTokens?: number | string;
  // API-Keys: write-only. Werden NUR beim Speichern gesendet (wenn der Nutzer tippt),
  // kommen NIE im GET zurück (verschlüsselt im Backend). Status via fetchKiProviders().
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}

export interface KiTestResult { ok: boolean; latencyMs?: number; model?: string; error?: string; }

export async function testKiProvider(provider: string): Promise<KiTestResult> {
  const env = await api.post<{ data: KiTestResult }>('/settings/ki/test', { provider });
  return env.data;
}

interface KiConfigEnvelope {
  data: KiConfig;
}

export interface KiProvider {
  provider: string;
  requiresKey: boolean;
  configured: boolean;       // Cloud: API-Key in ENV gesetzt?
  keyEnvVar: string | null;
}

interface KiProvidersEnvelope {
  data: { providers: KiProvider[]; active: string };
}

export async function fetchKiProviders(): Promise<{ providers: KiProvider[]; active: string }> {
  const env = await api.get<KiProvidersEnvelope>('/settings/ki/providers');
  return env.data;
}

export interface KiModelsEnvelope {
  data: string[];
  reachable: boolean;
  modelAvailable?: boolean | null;
  reason?: string;
  message?: string;
  error?: string;
}

export async function fetchKiConfig(): Promise<KiConfig> {
  const env = await api.get<KiConfigEnvelope>('/settings/ki');
  return env.data;
}

export async function saveKiConfig(config: KiConfig): Promise<KiConfig> {
  const env = await api.put<KiConfigEnvelope>('/settings/ki', config);
  return env.data;
}

export async function fetchKiModels(): Promise<KiModelsEnvelope> {
  return api.get<KiModelsEnvelope>('/settings/ki/models');
}

// ── Threat-Intel-Provider-Keys (Layer 2: UI-verwaltet, verschlüsselt) ─────────
import type { TiKeyStatus, TiProvider } from './tiKeysModel';

/** Verbindungstest-Ergebnis eines TI-Providers (ok oder Grund). */
export interface TiTestResult {
  ok: boolean;
  latencyMs?: number;
  summary?: string;
  reason?: string;   // z.B. 'not_configured', 'rate_limited', 'error'
  error?: string;
}

export async function fetchTiKeys(): Promise<TiKeyStatus[]> {
  const env = await api.get<{ data: TiKeyStatus[] }>('/settings/ti');
  return env.data;
}

export async function saveTiKeys(patch: Partial<Record<TiProvider, string>>): Promise<TiKeyStatus[]> {
  const env = await api.put<{ data: TiKeyStatus[] }>('/settings/ti', patch);
  return env.data;
}

export async function testTiProvider(provider: TiProvider, key?: string): Promise<TiTestResult> {
  const env = await api.post<{ data: TiTestResult }>('/settings/ti/test', key ? { provider, key } : { provider });
  return env.data;
}

// ── QRadar-Verbindung (Layer 2: UI-verwaltet, verschlüsselt) ──────────────────
import type { QradarMasked } from './qradarConnectionModel';

export interface QradarTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; }

export async function fetchQradarConnection(opts?: { signal?: AbortSignal }): Promise<QradarMasked> {
  const env = await api.get<{ data: QradarMasked }>('/qradar/connection', undefined, opts);
  return env.data;
}

export async function saveQradarConnection(payload: { password: string; baseUrl: string; token: string }): Promise<QradarMasked> {
  const env = await api.put<{ data: QradarMasked }>('/qradar/connection', payload);
  return env.data;
}

export async function testQradarConnection(payload: { baseUrl?: string; token?: string }): Promise<QradarTestResult> {
  const env = await api.post<{ data: QradarTestResult }>('/qradar/connection/test', payload);
  return env.data;
}

// ── Qdrant-Verbindung (Layer 2: UI-verwaltet) ─────────────────────────────────
import type { QdrantMasked } from './qdrantConnectionModel';

export interface QdrantTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; }

export async function fetchQdrantConnection(opts?: { signal?: AbortSignal }): Promise<QdrantMasked> {
  const env = await api.get<{ data: QdrantMasked }>('/rag/qdrant-connection', undefined, opts);
  return env.data;
}

export async function saveQdrantConnection(payload: { password: string; url: string; apiKey: string }): Promise<QdrantMasked> {
  const env = await api.put<{ data: QdrantMasked }>('/rag/qdrant-connection', payload);
  return env.data;
}

export async function testQdrantConnection(payload: { url?: string; apiKey?: string }): Promise<QdrantTestResult> {
  const env = await api.post<{ data: QdrantTestResult }>('/rag/qdrant-connection/test', payload);
  return env.data;
}

// ── CrowdSec-LAPI-Verbindung (Layer 2: UI-verwaltet) ──────────────────────────
import type { CrowdsecMasked } from './crowdsecConnectionModel';

export interface CrowdsecTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; warning?: string; }

export async function fetchCrowdsecConnection(opts?: { signal?: AbortSignal }): Promise<CrowdsecMasked> {
  const env = await api.get<{ data: CrowdsecMasked }>('/crowdsec/connection', undefined, opts);
  return env.data;
}

export async function saveCrowdsecConnection(payload: { password: string; baseUrl: string; machineId: string; lapiPassword: string; tlsInsecure: boolean }): Promise<CrowdsecMasked> {
  const env = await api.put<{ data: CrowdsecMasked }>('/crowdsec/connection', payload);
  return env.data;
}

export async function testCrowdsecConnection(payload: { baseUrl?: string; machineId?: string; lapiPassword?: string; tlsInsecure?: boolean }): Promise<CrowdsecTestResult> {
  const env = await api.post<{ data: CrowdsecTestResult }>('/crowdsec/connection/test', payload);
  return env.data;
}

// ── ServiceNow-Outbound-Verbindung (Layer 2: UI-verwaltet) ────────────────────
import type { ServicenowMasked } from './servicenowConnectionModel';

export interface ServicenowTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; }

export async function fetchServicenowConnection(opts?: { signal?: AbortSignal }): Promise<ServicenowMasked> {
  const env = await api.get<{ data: ServicenowMasked }>('/servicenow/connection', undefined, opts);
  return env.data;
}

export async function saveServicenowConnection(payload: { password: string; baseUrl: string; username: string; servicenowPassword: string; table: string }): Promise<ServicenowMasked> {
  const env = await api.put<{ data: ServicenowMasked }>('/servicenow/connection', payload);
  return env.data;
}

export async function testServicenowConnection(payload: { baseUrl?: string; username?: string; servicenowPassword?: string; table?: string }): Promise<ServicenowTestResult> {
  const env = await api.post<{ data: ServicenowTestResult }>('/servicenow/connection/test', payload);
  return env.data;
}

// ── OTRS/Znuny-Outbound-Verbindung (Layer 2: UI-verwaltet) ────────────────────
import type { OtrsMasked } from './otrsConnectionModel';

export interface OtrsTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; warning?: string; }

export async function fetchOtrsConnection(opts?: { signal?: AbortSignal }): Promise<OtrsMasked> {
  const env = await api.get<{ data: OtrsMasked }>('/otrs/connection', undefined, opts);
  return env.data;
}

export async function saveOtrsConnection(payload: { password: string; baseUrl: string; username: string; otrsPassword: string; queue: string; webService: string; operation: string }): Promise<OtrsMasked> {
  const env = await api.put<{ data: OtrsMasked }>('/otrs/connection', payload);
  return env.data;
}

export async function testOtrsConnection(payload: { baseUrl?: string; username?: string; otrsPassword?: string; webService?: string }): Promise<OtrsTestResult> {
  const env = await api.post<{ data: OtrsTestResult }>('/otrs/connection/test', payload);
  return env.data;
}

// ── IMAP-Postfach-Verbindung (Layer 2: UI-verwaltet) ──────────────────────────
import type { ImapMasked } from './imapConnectionModel';

export interface ImapTestResult { ok: boolean; latencyMs?: number; reason?: string; error?: string; }

export async function fetchImapConnection(opts?: { signal?: AbortSignal }): Promise<ImapMasked> {
  const env = await api.get<{ data: ImapMasked }>('/imap/connection', undefined, opts);
  return env.data;
}

export async function saveImapConnection(payload: { password: string; host: string; port: number; user: string; imapPassword: string; secure: boolean }): Promise<ImapMasked> {
  const env = await api.put<{ data: ImapMasked }>('/imap/connection', payload);
  return env.data;
}

export async function testImapConnection(payload: { host?: string; port?: number; user?: string; imapPassword?: string; secure?: boolean }): Promise<ImapTestResult> {
  const env = await api.post<{ data: ImapTestResult }>('/imap/connection/test', payload);
  return env.data;
}

// ── Inbound-Webhook-Secrets (Layer 2: Alert→Ticket-HMAC, UI-verwaltet) ────────
import type { MaskedWebhookSecret } from './webhookSecretsModel';

export async function fetchWebhookSecrets(opts?: { signal?: AbortSignal }): Promise<MaskedWebhookSecret[]> {
  const env = await api.get<{ data: MaskedWebhookSecret[] }>('/settings/webhook-secrets', undefined, opts);
  return env.data;
}

export async function saveWebhookSecret(payload: { source: string; secret: string }): Promise<MaskedWebhookSecret[]> {
  const env = await api.put<{ data: MaskedWebhookSecret[] }>('/settings/webhook-secrets', payload);
  return env.data;
}
