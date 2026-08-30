// Pure Logik der IMAP-Postfach-Verbindungs-Verwaltung (Layer 2) — ohne React.
// Passwort wird nur gesendet, wenn eingegeben (leer = unverändert). Der Poller
// übernimmt eine Änderung beim nächsten Zyklus (kein Neustart).

import i18n from '../../i18n';

export type ImapSource = 'db' | 'env' | 'none';

const DEFAULT_PORT = 993;

export interface ImapMasked {
  host: string;
  port: number;
  user: string;
  secure: boolean;
  passwordSet: boolean;
  source: ImapSource;
}

export interface ImapForm {
  host: string;
  port: string;          // Freitext im Input; Number() beim Patch
  user: string;
  imapPassword: string;  // leer = gespeichertes behalten
  secure: boolean;
}

export interface ImapPatch {
  host: string;
  port: number;
  user: string;
  imapPassword: string;
  secure: boolean;
}

/** Hostname (RFC 1123) oder IPv4 — grobe Vor-Validierung; Durchsetzung serverseitig. */
export function isValidHost(host: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(host);
}

export function imapFormFromMasked(m: ImapMasked): ImapForm {
  return { host: m.host, port: String(m.port || DEFAULT_PORT), user: m.user, imapPassword: '', secure: m.secure };
}

/** Patch bauen — oder null, wenn nichts zu senden ist. */
export function buildImapPatch(form: ImapForm, masked?: ImapMasked): ImapPatch | null {
  const host = form.host.trim();
  const user = form.user.trim();
  const port = Number(form.port) || DEFAULT_PORT;
  if (host === '') {
    return masked?.source === 'db' ? { host: '', port: DEFAULT_PORT, user: '', imapPassword: '', secure: true } : null;
  }
  const changed = !masked
    || host !== masked.host
    || user !== masked.user
    || port !== masked.port
    || form.imapPassword !== ''
    || form.secure !== masked.secure;
  return changed ? { host, port, user, imapPassword: form.imapPassword, secure: form.secure } : null;
}

/** Client-Vor-Validierung; '' = ok. */
export function imapConnError(form: ImapForm, masked: ImapMasked): string {
  const host = form.host.trim();
  if (host === '') return '';
  if (!isValidHost(host)) return i18n.t('settings.hostMustValidHostnameIp');
  const portStr = form.port.trim();
  if (portStr !== '') {
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return i18n.t('settings.portMustBetween165535');
  }
  const willWrite = buildImapPatch(form, masked) !== null;
  if (!willWrite) return '';
  if (form.user.trim() === '') return 'Benutzer erforderlich.';
  const hasStoredPassword = masked.source === 'db' && masked.passwordSet;
  if (form.imapPassword === '' && !hasStoredPassword) return i18n.t('ui.passwordRequiredStoredEncrypted');
  return '';
}

export function imapSourceLabel(source: ImapSource): string {
  if (source === 'db') return i18n.t('label.managedInterfaceEncryptedDatabase');
  if (source === 'env') return 'Systemwert';
  return i18n.t('text.notConfigured');
}
