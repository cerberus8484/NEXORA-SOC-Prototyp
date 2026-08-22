// Pure Logik des Outbound-Config-Formulars (Layer 2) — ohne React, testbar.
// Secrets (SMTP-Passwort, Webhook-URLs) werden nur gesendet, wenn eingegeben;
// leer = unverändert (spiegelt den Server).

import type { NotifConfigMasked, NotifConfigPatch, NotifSource } from './notificationsApi';

export interface OutboundEmailForm {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;   // leer = gespeichertes behalten
  from: string;
  to: string;
}

export interface OutboundForm {
  outboundEnabled: boolean;
  email: OutboundEmailForm;
  slackWebhookUrl: string;   // leer = behalten
  genericWebhookUrl: string; // leer = behalten
  teamsWebhookUrl: string;   // leer = behalten
}

export function emptyOutboundForm(): OutboundForm {
  return {
    outboundEnabled: false,
    email: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
    slackWebhookUrl: '',
    genericWebhookUrl: '',
    teamsWebhookUrl: '',
  };
}

/** Formular aus der maskierten Serversicht vorbefüllen (Secrets bleiben leer). */
export function formFromMasked(masked: NotifConfigMasked): OutboundForm {
  return {
    outboundEnabled: masked.outboundEnabled,
    email: {
      host: masked.email.host,
      port: masked.email.port,
      secure: masked.email.secure,
      user: masked.email.user,
      pass: '',
      from: masked.email.from,
      to: masked.email.to,
    },
    slackWebhookUrl: '',
    genericWebhookUrl: '',
    teamsWebhookUrl: '',
  };
}

/** Save-Payload bauen: Email immer, Webhook-Secrets nur wenn eingegeben. */
export function buildNotifConfigPatch(form: OutboundForm): NotifConfigPatch {
  const patch: NotifConfigPatch = {
    outboundEnabled: form.outboundEnabled,
    email: {
      host: form.email.host.trim(),
      port: form.email.port,
      secure: form.email.secure,
      user: form.email.user.trim(),
      pass: form.email.pass,          // leer = Server behält
      from: form.email.from.trim(),
      to: form.email.to.trim(),
    },
  };
  const slack = form.slackWebhookUrl.trim();
  const generic = form.genericWebhookUrl.trim();
  const teams = form.teamsWebhookUrl.trim();
  if (slack !== '') patch.slackWebhookUrl = slack;
  if (generic !== '') patch.genericWebhookUrl = generic;
  if (teams !== '') patch.teamsWebhookUrl = teams;
  return patch;
}

/** Ehrliches Herkunfts-Label (ENV-only sichtbar machen — Projekt-Regel). */
export function notifSourceLabel(source: NotifSource): string {
  if (source === 'db') return 'UI-verwaltet (verschlüsselt in DB)';
  if (source === 'env') return 'Systemwert';
  return 'Nicht konfiguriert';
}
