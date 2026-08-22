import { api } from '../../lib/apiClient';

// ── Typen ────────────────────────────────────────────────────────────────────

export type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Notification {
  id: string;
  userId: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  source: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationListParams {
  unreadOnly?: boolean;
  limit?: number;
}

export interface NotificationListResponse {
  data: Notification[];
  total: number;
  unreadCount: number;
}

export interface UnreadCountResponse {
  data: { count: number };
}

export interface MarkReadResponse {
  data: Notification;
}

export interface MarkAllReadResponse {
  data: { updated: number };
}

// ── Outbound-Kanal-Typen ─────────────────────────────────────────────────────

/**
 * Status eines einzelnen Outbound-Kanals.
 * NUR Booleans — niemals URLs oder Secrets.
 */
export interface ChannelStatus {
  id: string;
  configured: boolean;
}

/**
 * Response von GET /notifications/channels.
 * NUR Booleans — kein Secret-Leak möglich.
 */
export interface ChannelsResponse {
  outboundEnabled: boolean;
  channels: ChannelStatus[];
}

/**
 * Response von POST /notifications/test.
 * NUR Kanal-IDs bzw. skip-Grund — kein Secret-Leak möglich.
 */
export interface TestSendResponse {
  data: { sent?: string[]; skipped?: string };
}

// ── Outbound-Config-Typen (Layer 2: UI-verwaltet) ────────────────────────────

export type NotifSource = 'db' | 'env' | 'none';

/** Maskierte SMTP-Sektion — nie das Passwort, nur passwordSet + Quelle. */
export interface NotifEmailMasked {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  to: string;
  passwordSet: boolean;
  source: NotifSource;
}

/** Maskierter Webhook-Kanal — nie die URL, nur urlSet + Quelle. */
export interface NotifWebhookMasked {
  id: string;       // 'slack' | 'webhook' | 'teams'
  urlSet: boolean;
  source: NotifSource;
}

/** Maskierte Editier-Sicht (GET /notifications/config). */
export interface NotifConfigMasked {
  outboundEnabled: boolean;
  email: NotifEmailMasked;
  channels: NotifWebhookMasked[];
}

/** Speicher-Payload (PUT /notifications/config); Secrets leer = unverändert. */
export interface NotifConfigPatch {
  outboundEnabled?: boolean;
  email?: { host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string };
  slackWebhookUrl?: string;
  genericWebhookUrl?: string;
  teamsWebhookUrl?: string;
}

// ── API-Funktionen ────────────────────────────────────────────────────────────

export const notificationsApi = {
  /**
   * GET /notifications?unreadOnly=&limit=
   * Gibt paginierte Notifications mit unreadCount zurück.
   */
  list: (
    params: NotificationListParams = {},
    opts?: { signal?: AbortSignal },
  ): Promise<NotificationListResponse> =>
    api.get<NotificationListResponse>(
      '/notifications',
      params as unknown as Record<string, string | number | undefined>,
      opts,
    ),

  /**
   * GET /notifications/unread-count
   * Leichtgewichtige Route für das Topbar-Badge.
   */
  unreadCount: (
    opts?: { signal?: AbortSignal },
  ): Promise<UnreadCountResponse> =>
    api.get<UnreadCountResponse>('/notifications/unread-count', undefined, opts),

  /**
   * POST /notifications/:id/read
   * Markiert eine einzelne Notification als gelesen.
   */
  markRead: (
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MarkReadResponse> =>
    api.post<MarkReadResponse>(`/notifications/${id}/read`, undefined, opts),

  /**
   * POST /notifications/read-all
   * Markiert alle Notifications des aktuellen Nutzers als gelesen.
   */
  markAllRead: (
    opts?: { signal?: AbortSignal },
  ): Promise<MarkAllReadResponse> =>
    api.post<MarkAllReadResponse>('/notifications/read-all', undefined, opts),

  /**
   * GET /notifications/channels
   * Gibt den Konfigurationsstatus der Outbound-Kanäle zurück.
   * NUR für Admins — enthält ausschließlich Boolean-Felder (kein Secret-Leak).
   */
  getChannels: (
    opts?: { signal?: AbortSignal },
  ): Promise<ChannelsResponse> =>
    api.get<ChannelsResponse>('/notifications/channels', undefined, opts),

  /**
   * POST /notifications/test
   * Schickt eine Test-Benachrichtigung an die konfigurierten Outbound-Kanäle (nur Admin).
   * Antwort enthält nur Kanal-IDs bzw. skip-Grund — kein Secret.
   */
  sendTest: (
    opts?: { signal?: AbortSignal },
  ): Promise<TestSendResponse> =>
    api.post<TestSendResponse>('/notifications/test', undefined, opts),

  /** GET /notifications/config — maskierte Editier-Sicht (admin; nie Passwort/URL). */
  getConfig: (
    opts?: { signal?: AbortSignal },
  ): Promise<NotifConfigMasked> =>
    api.get<{ data: NotifConfigMasked }>('/notifications/config', undefined, opts).then((r) => r.data),

  /** PUT /notifications/config — Outbound-Config speichern (admin). */
  saveConfig: (
    patch: NotifConfigPatch,
  ): Promise<NotifConfigMasked> =>
    api.put<{ data: NotifConfigMasked }>('/notifications/config', patch).then((r) => r.data),
};
