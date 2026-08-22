// Pure Logik der Inbound-Webhook-Secrets-Verwaltung (Layer 2) — ohne React.
// Ein HMAC-Secret je Quelle (Alert→Ticket), verschlüsselt in der DB, ENV-Fallback.

export type WebhookOrigin = 'db' | 'env' | 'none';

/** Maskierte Sicht je Quelle vom Server — enthält NIE einen Secret-Wert. */
export interface MaskedWebhookSecret {
  source: string;
  set: boolean;
  origin: WebhookOrigin;
}

const SOURCE_LABELS: Record<string, string> = {
  wazuh:     'Wazuh (Alerts → Tickets)',
  qradar:    'QRadar',
  splunk:    'Splunk',
  dataplane: 'Data-Plane (Collector-Hub)',
  generic:   'Generisch (Fallback für alle)',
};

export function webhookSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function webhookOriginLabel(origin: WebhookOrigin): string {
  if (origin === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (origin === 'env') return 'Systemwert';
  return 'Nicht gesetzt — nutzt den generic-Fallback';
}

/** Badge-Ton je Herkunft (ehrliche Zustände). */
export function webhookOriginTone(m: MaskedWebhookSecret): 'success' | 'accent' | 'muted' {
  if (m.origin === 'db') return 'success';
  if (m.origin === 'env') return 'accent';
  return 'muted';
}

/**
 * Ein neues HMAC-Secret erzeugen (nur Frontend-Vorbefüllung; das Backend speichert es
 * verschlüsselt). 32 Byte als Hex. Nutzt WebCrypto, mit Math.random-Fallback.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') g.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
