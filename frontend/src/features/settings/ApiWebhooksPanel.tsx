// ApiWebhooksPanel — Settings → "API / Webhooks" Tab
//
// ADR-009 Ehrlichkeits-Regel:
//   ECHT (funktional, aus Backend):
//     - Basis-URL (Anzeige + Kopieren)
//     - Eingehende Webhook-Empfänger (Pfad + HMAC Boolean)
//     - Rate-Limits (read-only aus config)
//
//   GEPLANT (ehrlich, disabled, kein Fake):
//     - Persönliche/API-Tokens
//     - Ausgehende Webhooks + Event-Abonnements
//     - Retry-Verhalten + Zustell-Logs
//     - API & Webhooks Übersicht (Metriken/Charts)
//     - HMAC-Secret-Rotation
//
// SICHERHEIT: hmacConfigured ist nur boolean — kein Secret-Wert in der UI.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Activity, CheckCircle, Clock, Copy, Globe,
  Lock, RefreshCw, Send, XCircle, Zap,
} from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardHeader,
  EmptyState, Spinner, KeyValueRow,
} from '../../components/ui';
import {
  getApiInfo,
  formatWindowMs,
  formatMaxRequests,
  buildBaseUrl,
} from './apiWebhooksApi';
import type { ApiInfoData } from './apiWebhooksApi';
import { ApiTokensCard } from './components/ApiTokensCard';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

// ── Konstanten ────────────────────────────────────────────────────────────────

// Basis-URL: wird aus VITE_API_BASE abgeleitet (Anzeige ohne trailing slash)
const RAW_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '/api/v1';
const DISPLAY_BASE = buildBaseUrl(RAW_BASE);

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export function ApiWebhooksPanel() {
  const { t: tr } = useTranslation();
  const [info, setInfo]       = useState<ApiInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    let alive = true;
    getApiInfo()
      .then((d) => { if (alive) setInfo(d); })
      .catch(() => { if (alive) setError(i18n.t('settings.apiInformationCouldNotLoaded')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function handleCopyBase() {
    void navigator.clipboard.writeText(DISPLAY_BASE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Reihe 1: API-Zugriff + Rate-Limits */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* Eingehender API-Zugriff */}
        <Card>
          <CardHeader
            title={tr('settings.inboundApiAccess')}
            actions={<Badge tone="success" dot>{tr('common.active')}</Badge>}
          />
          <CardBody>
            <div style={s.stack}>
              <InfoNote>{tr('settings.apiAlwaysOn')}</InfoNote>

              <SectionLabel>Basis-URL</SectionLabel>
              <div style={s.row}>
                <Globe size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <code style={s.code}>{DISPLAY_BASE}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy size={12} />}
                  onClick={handleCopyBase}
                  title={tr('settings.copyBaseUrl')}
                >
                  {copied ? tr('common.copied') : tr('common.copy')}
                </Button>
              </div>

              <PlannedRow label={tr('settings.ipRestriction')} hint={tr('settings.allowlistPlanned')} />
            </div>
          </CardBody>
        </Card>

        {/* Rate-Limits (echt, read-only) */}
        <Card>
          <CardHeader
            title="Rate-Limits"
            actions={<Badge tone="accent">Read-only</Badge>}
          />
          <CardBody>
            {loading ? <Spinner /> : error ? (
              <EmptyState title={tr('common.notAvailable')} message={error} />
            ) : info ? (
              <div style={s.stack}>
                <InfoNote>{tr('settings.rateLimitEnv')}</InfoNote>
                <KeyValueRow
                  label="API-Requests"
                  value={formatMaxRequests(info.rateLimit.max, info.rateLimit.windowMs)}
                />
                <KeyValueRow
                  label="Webhook-Burst"
                  value={formatMaxRequests(info.rateLimit.webhookMax, info.rateLimit.windowMs)}
                />
                <KeyValueRow
                  label="Fenster"
                  value={formatWindowMs(info.rateLimit.windowMs)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Clock size={12} style={{ color: 'var(--text-dim)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Sliding-Window — Burst bis {info.rateLimit.webhookMax} Req./Fenster für SIEM-Quellen
                  </span>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Reihe 2: Eingehende Webhook-Empfänger (echt) */}
      <Card>
        <CardHeader
          title={tr('settings.incomingWebhookReceivers')}
          actions={<Badge tone="accent">Eingehend</Badge>}
        />
        <CardBody>
          {loading ? <Spinner /> : error ? (
            <EmptyState title={tr('common.notAvailable')} message={error} />
          ) : info ? (
            <div style={s.stack}>
              <InfoNote>{tr('settings.inboundWebhooksIntro')}<code style={s.inlineCode}>POST</code>{tr('settings.withHmacCheck')}</InfoNote>
              <div style={s.tableWrapper}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>{tr('common.source')}</th>
                      <th style={s.th}>Ingest-Pfad</th>
                      <th style={s.th}>HMAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.webhookReceivers.map((r) => (
                      <tr key={r.source} style={s.tr}>
                        <td style={s.td}>
                          <span style={{ fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', fontSize: 11 }}>
                            {r.source}
                          </span>
                        </td>
                        <td style={s.td}>
                          <code style={s.code}>{r.path}</code>
                        </td>
                        <td style={s.td}>
                          {r.hmacConfigured ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CheckCircle size={11} style={{ color: 'var(--success)' }} />
                              <Badge tone="success">{tr('common.configured')}</Badge>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <XCircle size={11} style={{ color: 'var(--warning)' }} />
                              <Badge tone="warning">{tr('text.notConfigured')}</Badge>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <InfoNote>
                HMAC-Secrets werden per ENV-Variable (<code style={s.inlineCode}>WEBHOOK_SECRET_&lt;SOURCE&gt;</code>{tr('settings.serverSideOnly')}</InfoNote>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Reihe 3: API-Tokens (real wenn enabled, sonst Geplant) + Geplant-Karten */}
      {/* ApiTokensCard entscheidet selbst ob Geplant oder aktiv anhand tokensEnabled */}
      <ApiTokensCard tokensEnabled={Boolean(info?.tokensEnabled)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* Platzhalter für künftiges Slot 3 (war PAT-PlannedCard) — jetzt ApiTokensCard oben */}

        <PlannedCard
          icon={<Send size={20} />}
          title="Ausgehende Webhooks"
          hint={tr('settings.registerYourOwnEndpointsNotified')}
        />

        <PlannedCard
          icon={<Activity size={20} />}
          title="Event-Abonnements"
          hint={tr('settings.chooseWhichEventTypesTicket')}
        />

        <PlannedCard
          icon={<RefreshCw size={20} />}
          title="Retry-Verhalten"
          hint={tr('settings.configurableRetryBackoffMaximumAttempts')}
        />

        <PlannedCard
          icon={<Zap size={20} />}
          title="Zustell-Logs"
          hint={tr('settings.logAllOutgoingWebhookDeliveries')}
        />

        <PlannedCard
          icon={<Lock size={20} />}
          title="HMAC-Secret-Rotation"
          hint={tr('settings.rotateSecretsIncomingWebhookReceivers')}
        />
      </div>

    </div>
  );
}

// ── Hilfskomponenten ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--text-dim)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      {children}
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--text-dim)',
      lineHeight: 1.6,
      padding: '8px 10px',
      background: 'var(--bg-card-soft)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-soft)',
    }}>
      {children}
    </div>
  );
}

function PlannedRow({ label, hint }: { label: string; hint: string }) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{hint}</div>
      </div>
      <Badge tone="muted">{tr('common.planned')}</Badge>
    </div>
  );
}

function PlannedCard({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: 0.65 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ color: 'var(--text-dim)' }}>{icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
            <span style={{ marginLeft: 'auto' }}><Badge tone="muted">{tr('common.planned')}</Badge></span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {hint}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>{tr('settings.backendLater')}</div>
          <Button variant="ghost" size="sm" disabled>{tr('common.configure')}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  code: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 12,
    background: 'var(--bg-input)',
    color: 'var(--accent)',
    padding: '2px 6px',
    borderRadius: 4,
    wordBreak: 'break-all',
  },
  inlineCode: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    background: 'var(--bg-input)',
    color: 'var(--text)',
    padding: '1px 4px',
    borderRadius: 3,
  },
  tableWrapper: {
    overflowX: 'auto' as const,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left' as const,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: 'var(--text-dim)',
    background: 'var(--bg-card-soft)',
    borderBottom: '1px solid var(--border-soft)',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-soft)',
    verticalAlign: 'middle' as const,
  },
  tr: {
    transition: 'background 0.1s',
  },
};
