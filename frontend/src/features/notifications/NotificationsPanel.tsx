import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Mail, MessageSquare, Webhook, Users, CheckCheck,
  Info, Send,
} from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { notificationsApi, type Notification, type ChannelsResponse } from './notificationsApi';
import { formatRelativeTime, severityToColor, severityToLabel, isChannelActive, formatTestResult } from './notificationsHelpers';
import { OutboundConfigCard } from './OutboundConfigCard';

const LIST_LIMIT = 20;

// ── Haupt-Panel ───────────────────────────────────────────────────────────────

export function NotificationsPanel() {
  const navigate = useNavigate();

  const [items, setItems]             = useState<Notification[]>([]);
  const [loading, setLoading]         = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll]   = useState(false);
  const [error, setError]             = useState('');

  // Outbound-Kanal-Status — nur Booleans, kein Secret-Leak möglich.
  const [channels, setChannels] = useState<ChannelsResponse | null>(null);

  // Test-Versand (Admin-Smoke-Test) — Ergebnis ist nur Kanal-IDs/skip-Grund.
  const [testBusy, setTestBusy]     = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    Promise.all([
      notificationsApi.list({ limit: LIST_LIMIT }, { signal: ctrl.signal }),
      notificationsApi.unreadCount({ signal: ctrl.signal }),
    ])
      .then(([listRes, countRes]) => {
        if (!alive) return;
        setItems(listRes.data);
        setUnreadCount(countRes.data.count);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (alive) setError('Benachrichtigungen konnten nicht geladen werden.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // Kanal-Status separat laden (nur für Admins — 403 für andere Rollen wird ignoriert).
    notificationsApi.getChannels({ signal: ctrl.signal })
      .then((res) => { if (alive) setChannels(res); })
      .catch(() => { /* 403 für Nicht-Admins ist erwartet und wird ignoriert */ });

    return () => { alive = false; ctrl.abort(); };
  }, []);

  const handleMarkRead = (n: Notification) => {
    if (n.read) return;
    notificationsApi.markRead(n.id)
      .then(() => {
        setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
        setUnreadCount((c) => Math.max(0, c - 1));
      })
      .catch(() => { /* nicht-blockierender Fehler */ });
  };

  const handleMarkAll = () => {
    if (markingAll) return;
    setMarkingAll(true);
    notificationsApi.markAllRead()
      .then(() => {
        setItems((prev) => prev.map((x) => ({ ...x, read: true })));
        setUnreadCount(0);
      })
      .catch(() => { /* nicht-blockierender Fehler */ })
      .finally(() => setMarkingAll(false));
  };

  const handleTest = () => {
    if (testBusy) return;
    setTestBusy(true);
    setTestResult('');
    notificationsApi.sendTest()
      .then((res) => setTestResult(formatTestResult(res.data)))
      .catch(() => setTestResult('Test-Versand fehlgeschlagen.'))
      .finally(() => setTestBusy(false));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Übersicht-Karten ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StatTile label="Geladen" value={loading ? '…' : String(items.length)} />
        <StatTile label="Ungelesen" value={loading ? '…' : String(unreadCount)} accent />
        <StatTile
          label="In-App-Kanal"
          value="Aktiv"
          tone="success"
          hint="Einziger aktiver Kanal"
        />
      </div>

      {/* ── Outbound-Editor (Layer 2, admin) — channels lädt nur für Admins ── */}
      {channels && <OutboundConfigCard />}

      {/* ── Kanal-Konfiguration (Statusübersicht) ── */}
      <Card>
        <CardHeader
          title="Benachrichtigungskanäle"
          actions={
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
              <Info size={12} /> In-App ist der einzige aktive Kanal
            </span>
          }
        />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>

            {/* In-App — immer aktiv */}
            <ChannelCard
              icon={<Bell size={18} />}
              title="In-App"
              status="active"
              statusLabel="Aktiv"
              description="Echtzeit-Benachrichtigungen direkt in der Topbar-Glocke. Kein externer Versand."
            />

            {/* E-Mail — echter Status aus /channels */}
            <EmailChannelCard channels={channels} />

            {/* Slack — echter Status aus /channels */}
            <SlackChannelCard channels={channels} />

            {/* Microsoft Teams — echter Status aus /channels */}
            <TeamsChannelCard channels={channels} />

            {/* Webhook — echter Status aus /channels */}
            <WebhookChannelCard channels={channels} />

          </div>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Test-Versand nur für Admins (channels lädt nur für Admins). */}
            {channels && (
              <Button
                variant="ghost"
                size="sm"
                disabled={testBusy}
                icon={<Send size={13} />}
                onClick={handleTest}
                title="Schickt eine Test-Benachrichtigung an die konfigurierten Outbound-Kanäle"
              >
                {testBusy ? 'Sende Test …' : 'Test-Benachrichtigung senden'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Weitere Kanäle werden in einer späteren Phase hinzugefügt"
            >
              Kanal hinzufügen — geplant
            </Button>
            {testResult && (
              <span role="status" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{testResult}</span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Geplante Einstellungen (ehrlich disabled) ── */}
      <Card>
        <CardHeader
          title="Benachrichtigungsregeln & Filter"
          actions={
            <Badge tone="warning">Geplant</Badge>
          }
        />
        <CardBody>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
            Die folgenden Einstellungen sind noch nicht konfigurierbar. Sie sind in einer späteren
            Phase geplant und haben aktuell keinen Effekt.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <PlannedCard title="Schweregrad-Routing">
              Welche Severity-Stufen welchen Kanal auslösen (z.B. critical → Slack, low → In-App).
            </PlannedCard>
            <PlannedCard title="Eskalationsregeln">
              Automatisches Weiterleiten bei ausbleibender Reaktion nach X Minuten.
            </PlannedCard>
            <PlannedCard title="Digest / Zusammenfassung">
              Stündliche oder tägliche Zusammenfassungs-E-Mails statt Einzel-Benachrichtigungen.
            </PlannedCard>
            <PlannedCard title="Ruhezeiten">
              Zeitfenster, in denen keine Benachrichtigungen gesendet werden (außer critical).
            </PlannedCard>
          </div>
        </CardBody>
      </Card>

      {/* ── Letzte Benachrichtigungen ── */}
      <Card>
        <CardHeader
          title="Letzte Benachrichtigungen"
          actions={
            unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<CheckCheck size={13} />}
                onClick={handleMarkAll}
                disabled={markingAll}
              >
                {markingAll ? 'Wird markiert …' : 'Alle als gelesen'}
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
          )}

          {loading ? (
            <Spinner />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bell size={28} />}
              title="Keine Benachrichtigungen"
              message="Es liegen noch keine In-App-Benachrichtigungen vor."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onMarkRead={handleMarkRead}
                  onNavigate={(link) => navigate(link)}
                />
              ))}
            </div>
          )}

          {!loading && items.length > 0 && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/settings?tab=notifications')}
              >
                Alle anzeigen
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── Hilfskomponenten ──────────────────────────────────────────────────────────

function StatTile({
  label, value, accent, tone, hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: 'success';
  hint?: string;
}) {
  const color = tone === 'success'
    ? 'var(--success)'
    : accent
      ? 'var(--accent)'
      : 'var(--text)';

  return (
    <div style={{
      background: 'var(--bg-card-soft)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function ChannelCard({
  icon, title, status, statusLabel, description,
}: {
  icon: React.ReactNode;
  title: string;
  status: 'active' | 'configured' | 'planned';
  statusLabel: string;
  description: string;
}) {
  const isActive     = status === 'active';
  const isConfigured = status === 'configured';

  const borderColor = isActive ? 'var(--success)' : isConfigured ? 'var(--accent)' : 'var(--border-soft)';
  const bgColor     = isActive ? 'rgba(0, 200, 100, 0.04)' : isConfigured ? 'rgba(100, 100, 255, 0.04)' : 'var(--bg-card-soft)';
  const iconColor   = isActive ? 'var(--success)' : isConfigured ? 'var(--accent)' : 'var(--text-dim)';
  const badgeTone: 'success' | 'accent' | 'warning' = isActive ? 'success' : isConfigured ? 'accent' : 'warning';

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-sm)',
      padding: '12px 14px',
      background: bgColor,
      opacity: isActive || isConfigured ? 1 : 0.7,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: iconColor }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        </div>
        <Badge tone={badgeTone}>
          {statusLabel}
        </Badge>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{description}</div>
      {!isActive && !isConfigured && (
        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" size="sm" disabled title="Kanal noch nicht verfügbar">
            Konfigurieren — geplant
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Echte Kanal-Karten (Slack + Webhook) ─────────────────────────────────────

function SlackChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  if (!channels) {
    return (
      <ChannelCard
        icon={<MessageSquare size={18} />}
        title="Slack"
        status="planned"
        statusLabel="Geplant"
        description="Webhook-Integration ist konfigurierbar. Status wird geladen…"
      />
    );
  }

  const slackCh = channels.channels.find((c) => c.id === 'slack');
  const configured = Boolean(slackCh?.configured);
  const active = isChannelActive(channels.outboundEnabled, configured);

  if (active) {
    return (
      <ChannelCard
        icon={<MessageSquare size={18} />}
        title="Slack"
        status="active"
        statusLabel="Versand aktiv"
        description="Slack-Webhook ist konfiguriert und Versand ist aktiviert (ENV-Flag gesetzt)."
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<MessageSquare size={18} />}
        title="Slack"
        status="configured"
        statusLabel="Konfiguriert"
        description="Slack-Webhook ist konfiguriert, aber der Versand ist inaktiv (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt)."
      />
    );
  }

  return (
    <ChannelCard
      icon={<MessageSquare size={18} />}
      title="Slack"
      status="planned"
      statusLabel="Nicht konfiguriert"
      description="Slack-Webhook-URL nicht gesetzt — kein Versand. NOTIFY_SLACK_WEBHOOK_URL konfigurieren."
    />
  );
}

function TeamsChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  if (!channels) {
    return (
      <ChannelCard
        icon={<Users size={18} />}
        title="Microsoft Teams"
        status="planned"
        statusLabel="Geplant"
        description="Teams-Webhook (Incoming Webhook) ist konfigurierbar. Status wird geladen…"
      />
    );
  }

  const teamsCh = channels.channels.find((c) => c.id === 'teams');
  const configured = Boolean(teamsCh?.configured);
  const active = isChannelActive(channels.outboundEnabled, configured);

  if (active) {
    return (
      <ChannelCard
        icon={<Users size={18} />}
        title="Microsoft Teams"
        status="active"
        statusLabel="Versand aktiv"
        description="Teams-Webhook ist konfiguriert und Versand ist aktiviert (ENV-Flag gesetzt)."
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Users size={18} />}
        title="Microsoft Teams"
        status="configured"
        statusLabel="Konfiguriert"
        description="Teams-Webhook ist konfiguriert, aber der Versand ist inaktiv (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt)."
      />
    );
  }

  return (
    <ChannelCard
      icon={<Users size={18} />}
      title="Microsoft Teams"
      status="planned"
      statusLabel="Nicht konfiguriert"
      description="Teams-Webhook-URL nicht gesetzt — kein Versand. NOTIFY_TEAMS_WEBHOOK_URL konfigurieren (Incoming-Webhook-Connector im Kanal)."
    />
  );
}

function WebhookChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  if (!channels) {
    return (
      <ChannelCard
        icon={<Webhook size={18} />}
        title="Webhook"
        status="planned"
        statusLabel="Geplant"
        description="Generischer HTTP-Webhook für SIEM/SOAR-Systeme. Status wird geladen…"
      />
    );
  }

  const webhookCh = channels.channels.find((c) => c.id === 'webhook');
  const configured = Boolean(webhookCh?.configured);
  const active = isChannelActive(channels.outboundEnabled, configured);

  if (active) {
    return (
      <ChannelCard
        icon={<Webhook size={18} />}
        title="Webhook"
        status="active"
        statusLabel="Versand aktiv"
        description="Generischer Webhook ist konfiguriert und Versand ist aktiviert (ENV-Flag gesetzt)."
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Webhook size={18} />}
        title="Webhook"
        status="configured"
        statusLabel="Konfiguriert"
        description="Webhook-URL ist konfiguriert, aber der Versand ist inaktiv (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt)."
      />
    );
  }

  return (
    <ChannelCard
      icon={<Webhook size={18} />}
      title="Webhook"
      status="planned"
      statusLabel="Nicht konfiguriert"
      description="Webhook-URL nicht gesetzt — kein Versand. NOTIFY_WEBHOOK_URL konfigurieren."
    />
  );
}

function EmailChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  if (!channels) {
    return (
      <ChannelCard
        icon={<Mail size={18} />}
        title="E-Mail"
        status="planned"
        statusLabel="Geplant"
        description="E-Mail-Versand per SMTP ist konfigurierbar. Status wird geladen…"
      />
    );
  }

  const emailCh = channels.channels.find((c) => c.id === 'email');
  const configured = Boolean(emailCh?.configured);
  const active = isChannelActive(channels.outboundEnabled, configured);

  if (active) {
    return (
      <ChannelCard
        icon={<Mail size={18} />}
        title="E-Mail"
        status="active"
        statusLabel="Versand aktiv"
        description="SMTP ist konfiguriert und Versand ist aktiviert (ENV-Flag gesetzt)."
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Mail size={18} />}
        title="E-Mail"
        status="configured"
        statusLabel="Konfiguriert"
        description="SMTP ist konfiguriert, aber der Versand ist inaktiv (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt)."
      />
    );
  }

  return (
    <ChannelCard
      icon={<Mail size={18} />}
      title="E-Mail"
      status="planned"
      statusLabel="Nicht konfiguriert"
      description="SMTP nicht gesetzt — kein Versand. NOTIFY_SMTP_HOST und NOTIFY_EMAIL_TO konfigurieren (optional NOTIFY_SMTP_USER/PASS, NOTIFY_EMAIL_FROM)."
    />
  );
}

function PlannedCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      background: 'var(--bg-card-soft)',
      opacity: 0.7,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{children}</div>
      <div style={{ marginTop: 8 }}><Badge tone="warning">Geplant – kein Effekt</Badge></div>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onMarkRead,
  onNavigate,
}: {
  notification: Notification;
  onMarkRead: (n: Notification) => void;
  onNavigate: (link: string) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid var(--border-soft)',
      background: n.read ? 'transparent' : 'var(--bg-card-soft)',
      borderRadius: 'var(--radius-sm)',
    }}>
      {/* Severity-Dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 5,
          background: severityToColor(n.severity),
        }}
        title={severityToLabel(n.severity)}
      />

      {/* Inhalt */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{n.title}</span>
          <Badge tone={n.severity === 'critical' ? 'danger' : n.severity === 'high' ? 'warning' : 'muted'}>
            {severityToLabel(n.severity)}
          </Badge>
          {!n.read && <Badge tone="accent">Neu</Badge>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>
          {n.body}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 10.5, color: 'var(--text-dim)' }}>
          <span>{n.source}</span>
          <span>·</span>
          <span>{formatRelativeTime(n.createdAt)}</span>
        </div>
      </div>

      {/* Aktionen */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {!n.read && (
          <Button variant="ghost" size="sm" onClick={() => onMarkRead(n)} title="Als gelesen markieren">
            <CheckCheck size={12} />
          </Button>
        )}
        {n.link && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(n.link!)} title="Zum Ticket navigieren">
            →
          </Button>
        )}
      </div>
    </div>
  );
}
