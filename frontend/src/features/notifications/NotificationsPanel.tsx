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
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

const LIST_LIMIT = 20;

// ── Haupt-Panel ───────────────────────────────────────────────────────────────

export function NotificationsPanel() {
  const { t: tr } = useTranslation();
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
        if (alive) setError(i18n.t('ui.notificationsCouldNotLoaded'));
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
      .catch(() => setTestResult(tr('notifications.testSendFailed')))
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
          value={tr('common.active')}
          tone="success"
          hint="Einziger aktiver Kanal"
        />
      </div>

      {/* ── Outbound-Editor (Layer 2, admin) — channels lädt nur für Admins ── */}
      {channels && <OutboundConfigCard />}

      {/* ── Kanal-Konfiguration (Statusübersicht) ── */}
      <Card>
        <CardHeader
          title={tr('ui.notificationChannels')}
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
              statusLabel={tr('common.active')}
              description={tr('ui.realTimeNotificationsRightTop')}
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
                title={tr('ui.sendsTestNotificationConfiguredOutbound')}
              >
                {testBusy ? 'Sende Test …' : tr('notifications.sendTest')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled
              title={tr('ui.moreChannelsWillAddedLater')}
            >{tr('notifications.addChannelPlanned')}</Button>
            {testResult && (
              <span role="status" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{testResult}</span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Geplante Einstellungen (ehrlich disabled) ── */}
      <Card>
        <CardHeader
          title={tr('notifications.rulesAndFilters')}
          actions={
            <Badge tone="warning">{tr('common.planned')}</Badge>
          }
        />
        <CardBody>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>{tr('notifications.plannedSettings')}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <PlannedCard title="Schweregrad-Routing">{tr('notifications.severityRouting')}</PlannedCard>
            <PlannedCard title={tr('notifications.escalationRules')}>
              Automatisches Weiterleiten bei ausbleibender Reaktion nach X Minuten.
            </PlannedCard>
            <PlannedCard title={tr('notifications.digestSummary')}>{tr('notifications.digestMails')}</PlannedCard>
            <PlannedCard title="Ruhezeiten">{tr('notifications.quietHours')}</PlannedCard>
          </div>
        </CardBody>
      </Card>

      {/* ── Letzte Benachrichtigungen ── */}
      <Card>
        <CardHeader
          title={tr('notifications.latest')}
          actions={
            unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<CheckCheck size={13} />}
                onClick={handleMarkAll}
                disabled={markingAll}
              >
                {markingAll ? tr('text.marking') : tr('ui.allRead')}
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
              title={tr('text.noNotifications')}
              message={tr('ui.thereNoAppNotificationsYet')}
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
              >{tr('common.showAll')}</Button>
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
  const { t: tr } = useTranslation();
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
          <Button variant="ghost" size="sm" disabled title={tr('ui.channelNotAvailableYet')}>{tr('common.configurePlanned')}</Button>
        </div>
      )}
    </div>
  );
}

// ── Echte Kanal-Karten (Slack + Webhook) ─────────────────────────────────────

function SlackChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  const { t: tr } = useTranslation();
  if (!channels) {
    return (
      <ChannelCard
        icon={<MessageSquare size={18} />}
        title="Slack"
        status="planned"
        statusLabel={tr('common.planned')}
        description={tr('ui.webhookIntegrationConfigurableLoadingStatus')}
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
        statusLabel={tr('text.deliveryActive')}
        description={tr('ui.slackWebhookConfiguredSendingEnabled')}
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<MessageSquare size={18} />}
        title="Slack"
        status="configured"
        statusLabel={tr('common.configured')}
        description={tr('ui.slackWebhookConfiguredButSending')}
      />
    );
  }

  return (
    <ChannelCard
      icon={<MessageSquare size={18} />}
      title="Slack"
      status="planned"
      statusLabel={tr('text.notConfigured')}
      description={tr('ui.slackWebhookUrlNotSet')}
    />
  );
}

function TeamsChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  const { t: tr } = useTranslation();
  if (!channels) {
    return (
      <ChannelCard
        icon={<Users size={18} />}
        title="Microsoft Teams"
        status="planned"
        statusLabel={tr('common.planned')}
        description={tr('ui.teamsWebhookIncomingWebhookConfigurable')}
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
        statusLabel={tr('text.deliveryActive')}
        description={tr('ui.teamsWebhookConfiguredSendingEnabled')}
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Users size={18} />}
        title="Microsoft Teams"
        status="configured"
        statusLabel={tr('common.configured')}
        description={tr('ui.teamsWebhookConfiguredButSending')}
      />
    );
  }

  return (
    <ChannelCard
      icon={<Users size={18} />}
      title="Microsoft Teams"
      status="planned"
      statusLabel={tr('text.notConfigured')}
      description={tr('ui.teamsWebhookUrlNotSet')}
    />
  );
}

function WebhookChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  const { t: tr } = useTranslation();
  if (!channels) {
    return (
      <ChannelCard
        icon={<Webhook size={18} />}
        title="Webhook"
        status="planned"
        statusLabel={tr('common.planned')}
        description={tr('ui.genericHttpWebhookSiemSoar')}
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
        statusLabel={tr('text.deliveryActive')}
        description={tr('ui.genericWebhookConfiguredSendingEnabled')}
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Webhook size={18} />}
        title="Webhook"
        status="configured"
        statusLabel={tr('common.configured')}
        description={tr('ui.webhookUrlConfiguredButSending')}
      />
    );
  }

  return (
    <ChannelCard
      icon={<Webhook size={18} />}
      title="Webhook"
      status="planned"
      statusLabel={tr('text.notConfigured')}
      description={tr('ui.webhookUrlNotSetNothing')}
    />
  );
}

function EmailChannelCard({ channels }: { channels: ChannelsResponse | null }) {
  const { t: tr } = useTranslation();
  if (!channels) {
    return (
      <ChannelCard
        icon={<Mail size={18} />}
        title="E-Mail"
        status="planned"
        statusLabel={tr('common.planned')}
        description={tr('ui.emailDeliveryOverSmtpConfigurable')}
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
        statusLabel={tr('text.deliveryActive')}
        description={tr('ui.smtpConfiguredSendingEnabledEnvironment')}
      />
    );
  }

  if (configured && !channels.outboundEnabled) {
    return (
      <ChannelCard
        icon={<Mail size={18} />}
        title="E-Mail"
        status="configured"
        statusLabel={tr('common.configured')}
        description={tr('ui.smtpConfiguredButSendingInactive')}
      />
    );
  }

  return (
    <ChannelCard
      icon={<Mail size={18} />}
      title="E-Mail"
      status="planned"
      statusLabel={tr('text.notConfigured')}
      description={tr('ui.smtpNotSetNothingSent')}
    />
  );
}

function PlannedCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { t: tr } = useTranslation();
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
      <div style={{ marginTop: 8 }}><Badge tone="warning">{tr('ui.plannedNoEffect')}</Badge></div>
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
  const { t: tr } = useTranslation();
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
          <Button variant="ghost" size="sm" onClick={() => onMarkRead(n)} title={tr('notifications.markRead')}>
            <CheckCheck size={12} />
          </Button>
        )}
        {n.link && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(n.link!)} title={tr('text.goTicket')}>
            →
          </Button>
        )}
      </div>
    </div>
  );
}
