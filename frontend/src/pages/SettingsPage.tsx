import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Shield, Users, Bell, Database, Palette,
  Server, Activity, RefreshCw, Download, CheckCircle, Lock, Info, Lightbulb,
} from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Input, Select, Toggle, EmptyState, Spinner, Field, HelpTip, ExampleHint } from '../components/ui';
import { api } from '../lib/apiClient';
import { systemApi, type SystemStats } from '../features/system/systemApi';
import { formatBytes, totalRecords } from '../features/settings/storageRetentionHelpers';
import { useAuth } from '../lib/auth';
import { hasRole } from '../lib/rbac';
import { UsersPanel } from '../features/users/UsersPanel';
import {
  getPlatform, savePlatform,
  type PlatformSettings,
} from '../features/settings/settingsApi';
import { OidcSettingsCard } from '../features/settings/OidcSettingsCard';
// Integrations-Konfig (TI-Keys, Verbindungs-Cards, Webhook-Secrets) liegt jetzt auf
// der eigenen Seite /integrations/config im Integrations-Bereich — nicht mehr hier.
import { computeSecurityPosture } from '../features/settings/securityScore';
import { SecurityPostureCards } from '../features/settings/SecurityPosture';
import { SecurityScoreCard } from '../features/settings/SecurityScoreCard';
import { SecurityEventsFeed } from '../features/settings/SecurityEventsFeed';
import { validatePasswordChange } from '../features/auth/passwordChangeModel';
import { authApi } from '../features/auth/authApi';
import { useAutoResetFlag } from '../hooks/useAutoResetFlag';
import { MfaSecurityCard } from '../features/mfa/MfaSecurityCard';
import { NotificationsPanel } from '../features/notifications/NotificationsPanel';
import { StorageRetentionPanel } from '../features/settings/StorageRetentionPanel';
import { BrandingPanel } from '../features/settings/BrandingPanel';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

interface HealthResponse { status: string; service: string; version: string; env: string; uptime: number; db?: string; }

type TabDef = { id: string; label: string; icon: React.ReactNode; minRole?: 'admin' | 'engineer' | 'analyst' };

const tabs = (): TabDef[] => [
  { id: 'general',       label: 'Allgemein',               icon: <Server size={13} /> },
  { id: 'users',         label: i18n.t('settings.usersRoles'),       icon: <Users size={13} />,   minRole: 'admin' },
  { id: 'security',      label: i18n.t('nav.security'),              icon: <Shield size={13} />,  minRole: 'admin' },
  { id: 'notifications', label: i18n.t('nav.notifications'),      icon: <Bell size={13} />,    minRole: 'admin' },
  { id: 'retention',     label: i18n.t('nav.storageRetention'), icon: <Database size={13} />,minRole: 'admin' },
  { id: 'branding',      label: 'Branding / Thema',        icon: <Palette size={13} />, minRole: 'admin' },
  // 'Threat Hunting' + 'Audit & Compliance' liegen jetzt in ihren Bereichen:
  // /hunting/settings (Hunting) bzw. /compliance/audit (Compliance) — nicht mehr hier.
];

export function SettingsPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const role = user?.role;

  const visibleTabs = tabs().filter((t) => !t.minRole || hasRole(role, t.minRole));
  const [tab, setTab] = useState(() => {
    const first = tabs().filter((t) => !t.minRole || hasRole(role, t.minRole))[0];
    return first?.id ?? 'general';
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{tr('settings.systemSettingsTitle')}<HelpTip topic="benutzer-rollen" /></h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '4px 0 0' }}>{tr('settings.pageSubtitle')}</p>
        </div>
        {/* Export-Button: noch kein API-Endpunkt — disabled mit erklärendem Tooltip */}
        <Button
          variant="ghost"
          icon={<Download size={14} />}
          disabled
          title={tr('settings.exportLaterRelease')}
        >{tr('settings.exportSettings')}</Button>
      </div>

      {/* Tab Bar */}
      <div role="tablist" aria-label={tr('settings.systemSettingsTitle')} style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 24, overflowX: 'auto' }}>
        {visibleTabs.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`settings-tabpanel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 500,
                background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                color: selected ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: selected ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div role="tabpanel" id={`settings-tabpanel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'general'       && <GeneralTab isAdmin={isAdmin} />}
        {tab === 'users'         && <UsersPanel />}
        {tab === 'security'      && <SecurityTab isAdmin={isAdmin} />}
        {tab === 'notifications' && <NotificationsPanel />}
        {tab === 'retention'     && <StorageRetentionPanel />}
        {tab === 'branding'      && <BrandingPanel />}
      </div>
    </div>
  );
}

// ── Allgemein ─────────────────────────────────────────────────────────────────

const PLATFORM_DEFAULTS: PlatformSettings = {
  platformName:       'Nexora SOC Platform',
  defaultView:        'dashboard',
  timezone:           'Europe/Berlin',
  language:           'de',
  maintenanceMode:    false,
  betaFeatures:       false,
  // Phase 2: Security-Keys mit sicheren Defaults
  passwordMinLength:  8,
  passwordComplexity: 'medium',
  sessionMaxHours:    8,
  // Account-Lockout (0 = deaktiviert)
  lockoutMaxAttempts: 0,
  lockoutMinutes:     15,
  // Branding
  accentColor: '#3b82f6',
};

function GeneralTab({ isAdmin }: { isAdmin: boolean }) {
  const { t: tr } = useTranslation();
  const [settings, setSettings]   = useState<PlatformSettings>(PLATFORM_DEFAULTS);
  const [loading, setLoading]     = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg]       = useState('');

  useEffect(() => {
    let alive = true;
    getPlatform()
      .then((d) => { if (alive) setSettings(d); })
      .catch(() => { if (alive) setErrMsg(i18n.t('settings.loadFailed2')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loading && settings.platformName) {
      document.title = settings.platformName;
    }
  }, [loading, settings.platformName]);

  const handleSave = async () => {
    setSaveState('saving');
    setErrMsg('');
    try {
      const saved = await savePlatform(settings);
      setSettings(saved);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('common.savingFailed');
      setErrMsg(msg);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI-Reihe: System-Metriken oben */}
      <SystemStatusCard />

      {/* Hauptbereich: 2-Spalten */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* Linke Spalte: Plattform-Informationen + Weitere Einstellungen */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <Card>
            <CardHeader
              title={tr('settings.platformInfo')}
              actions={!loading && settings.platformName ? <Badge>{settings.platformName}</Badge> : undefined}
            />
            <CardBody>
              {loading ? <Spinner /> : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                  <SettingsRow label={helpLabel('Plattformname', (
                    <ExampleHint
                      title={tr('settings.instanceNameLabel')}
                      text={tr('settings.platformNameHint')}
                      exampleLabel={tr('common.typicalEntry')}
                      rows={[
                        { label: 'Name', value: 'Nexora SOC Frankfurt' },
                        { label: 'Kurzform', value: 'Nexora SOC' },
                      ]}
                      footer={tr('settings.platformNameExample')}
                    />
                  ))}>
                    <Input
                      value={settings.platformName}
                      disabled={!isAdmin}
                      onChange={(e) => setSettings((s) => ({ ...s, platformName: e.target.value }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel(tr('settings.timezoneLabel'), (
                    <ExampleHint
                      title={tr('settings.timezoneMeaning')}
                      text={tr('settings.timezoneHint')}
                      exampleLabel="Beispiel"
                      rows={[
                        { label: 'Team in DE', value: 'Europe/Berlin' },
                        { label: 'Neutral', value: 'UTC' },
                      ]}
                      footer={tr('settings.timezoneExample')}
                    />
                  ))}>
                    <Select
                      value={settings.timezone}
                      disabled={!isAdmin}
                      options={[
                        { value: 'Europe/Berlin', label: '(UTC+02:00) Europe/Berlin' },
                        { value: 'UTC',           label: 'UTC' },
                        { value: 'US/Eastern',    label: tr('settings.tzUsEastern') },
                      ]}
                      onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel(tr('settings.language'), tr('settings.languageHint'))}>
                    <Select
                      value={settings.language}
                      disabled={!isAdmin}
                      options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]}
                      onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value as PlatformSettings['language'] }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel(tr('settings.defaultViewLabel'), (
                    <ExampleHint
                      title={tr('settings.whereSessionsLand')}
                      text={tr('settings.defaultViewHint')}
                      exampleLabel="Typischer Start"
                      rows={[
                        { label: 'Tier-1-Team', value: 'Dashboard' },
                        { label: 'Bearbeitungsteam', value: 'Tickets' },
                      ]}
                      footer={tr('settings.defaultViewExample')}
                    />
                  ))}>
                    <Select
                      value={settings.defaultView}
                      disabled={!isAdmin}
                      options={[
                        { value: 'dashboard', label: 'Dashboard' },
                        { value: 'tickets',   label: 'Tickets' },
                        { value: 'hunts',     label: 'Threat Hunts' },
                      ]}
                      onChange={(e) => setSettings((s) => ({ ...s, defaultView: e.target.value as PlatformSettings['defaultView'] }))}
                    />
                  </SettingsRow>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <ToggleRow
                      label={helpLabel(tr('settings.maintenanceModeLabel'), (
                        <ExampleHint
                          title={tr('settings.maintenanceShort')}
                          text={tr('settings.maintenanceHint')}
                          exampleLabel="Typischer Einsatz"
                          rows={[
                            { label: 'Situation', value: 'DB-Migration / Upgrade' },
                            { label: tr('common.effect'), value: tr('settings.onlyAdminsContinue') },
                          ]}
                          footer={tr('settings.maintenanceExample')}
                        />
                      ))}
                      desc={tr('settings.maintenanceLabel')}
                      checked={settings.maintenanceMode}
                      onChange={(v) => setSettings((s) => ({ ...s, maintenanceMode: v }))}
                      disabled={!isAdmin}
                    />
                    <ToggleRow
                      label={helpLabel(tr('settings.enableFeaturePreview'), tr('settings.betaHint'))}
                      desc={tr('settings.betaAccess')}
                      checked={settings.betaFeatures}
                      onChange={(v) => setSettings((s) => ({ ...s, betaFeatures: v }))}
                      disabled={!isAdmin}
                    />
                  </div>
                  {errMsg && <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--danger)' }}>{errMsg}</div>}
                  {isAdmin && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Button
                        variant={saveState === 'saved' ? 'success' : 'primary'}
                        size="sm"
                        onClick={handleSave}
                        disabled={saveState === 'saving'}
                      >
                        {saveState === 'saving' ? tr('text.saving')
                          : saveState === 'saved' ? tr('common.savedCheck')
                          : tr('common.save')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Verwandte Einstellungen — ehrliche Verweise statt toter Kontrollelemente (ADR-009) */}
          <Card>
            <CardHeader
              title={tr('settings.relatedSettings2')}
              actions={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                  <Info size={12} />{tr('settings.whatIsConfiguredWhere')}</span>
              }
            />
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <SettingsGroup title={tr('settings.authenticationAccess')}>
                  <CrossRef label={tr('settings.passwordSessionLockout')} target={tr('nav.security')} />
                  <CrossRef label={tr('settings.usersRolesRbac')} target={tr('settings.usersRoles')} />
                  <CrossRef label={tr('settings.ssoOidcRow')} target={tr('nav.security')} />
                </SettingsGroup>

                <SettingsGroup title={tr('settings.dataAndRetention')}>
                  <CrossRef label={tr('settings.storageBackupRetention')} target={tr('nav.storageRetention')} />
                  <CrossRef label={tr('settings.auditActivityCompliance')} target="Audit & Compliance" />
                  <CrossRef label="Branding & Akzentfarbe" target="Branding / Thema" />
                </SettingsGroup>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Rechte Spalte: Lizenz */}
        <LizenzCard />
      </div>
    </div>
  );
}

// ── System-Status ─────────────────────────────────────────────────────────────

function SystemStatusCard() {
  const { t: tr } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError]   = useState(false);

  useEffect(() => {
    let alive = true;
    api.get<HealthResponse>('/health')
      .then((r) => { if (alive) setHealth(r); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  if (error) {
    return (
      <div style={{ background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '16px 20px' }}>
        <EmptyState title={tr('settings.apiUnreachable')} message={tr('settings.checkBackend2')} />
      </div>
    );
  }

  const tiles = health ? [
    { label: 'API-Status',    value: health.status === 'ok' ? 'Online' : health.status, sub: health.service, color: health.status === 'ok' ? 'var(--success)' : 'var(--warning)', icon: <Server size={18} /> },
    { label: tr('settings.databaseLabel'),     value: health.db === 'ok' ? tr('settings.connectedLabel') : tr('common.check'),       sub: 'PostgreSQL',   color: health.db === 'ok' ? 'var(--success)' : 'var(--warning)',  icon: <Activity size={18} /> },
    { label: 'Version',       value: health.version,                                    sub: health.env,     color: 'var(--accent)',                                             icon: <CheckCircle size={18} /> },
    { label: 'Uptime',        value: fmtUptime(health.uptime),                          sub: tr('settings.uptimeLabel'),     color: 'var(--success)',                                            icon: <RefreshCw size={18} /> },
  ] : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {!health ? (
        Array.from({ length: 4 }).map((_, i) => (
          // Feste Skeleton-Platzhalter ohne Daten — Index ist hier der einzig sinnvolle Key
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} style={{ background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 88 }}>
            <Spinner />
          </div>
        ))
      ) : tiles.map(({ label, value, sub, color, icon }) => (
        <div key={label} style={{
          background: 'var(--bg-card-soft)',
          border: '1px solid var(--border-soft)',
          borderRadius: 'var(--radius-sm)',
          borderLeft: `3px solid ${color}`,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ color, opacity: 0.8 }}>{icon}</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Lizenz & Nutzung ──────────────────────────────────────────────────────────

function LizenzCard() {
  const { t: tr } = useTranslation();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    systemApi.stats()
      .then((res) => { if (alive) setStats(res.data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);

  const users   = stats?.counts?.users;
  const records = stats?.counts ? totalRecords(stats.counts) : undefined;
  const dbBytes = stats?.storage?.dbBytes;

  // Ehrlich: kein Fake-Quota-Balken. Community/Open-Source hat keine Nutzer-/Speichergrenze,
  // daher echte absolute Zahlen statt erfundener Prozent-Balken (ADR-009).
  const fmt = (n: number | undefined) =>
    error ? '—' : (typeof n === 'number' ? n.toLocaleString('de-DE') : '…');

  return (
    <Card>
      <CardHeader title={tr('settings.licenseUsage')} />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <KV k="Edition"       v={<Badge tone="accent">Community</Badge>} />
            <KV k="Lizenzstatus"  v={<Badge tone="success" dot>{tr('common.active')}</Badge>} />
            <KV k={tr('settings.validUntil2')}    v="Open Source" />
          </div>

          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <KV k={tr('common.users')}          v={fmt(users)} />
            <KV k={tr('settings.totalRecords')} v={fmt(records)} />
            <KV k={tr('settings.databaseSize2')}    v={error ? '—' : (typeof dbBytes === 'number' ? formatBytes(dbBytes) : '…')} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('settings.realValuesNoLimit')}</div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Sicherheit Tab ────────────────────────────────────────────────────────────
// ADR-009 Ehrlichkeits-Regel:
//   Echt erzwungen (real speicherbar):   passwordMinLength, passwordComplexity, sessionMaxHours
//   Nicht erzwungen (disabled, ehrlich): MFA, SSO, IP-Allowlist, TLS, Ablauf, History,
//                                        Inaktivitäts-Timeout, Session-Sperren, Login-Rate-Limit
// Security Score: transparent aus echten Signalen berechnet — kein Hardcode.
// Letzte Passwortänderung: "—" (serverseitig kein per-user-tracking).

type SecuritySettings = {
  passwordMinLength:  number;
  passwordComplexity: PlatformSettings['passwordComplexity'];
  sessionMaxHours:    number;
  lockoutMaxAttempts: number;
  lockoutMinutes:     number;
  passwordHistoryCount: number;
  passwordExpiryDays:   number;
  maxConcurrentSessions:    number;
  inactivityTimeoutMinutes: number;
  tlsEnforce:         boolean;
  ipAllowlistEnabled: boolean;
  ipAllowlistCidrs:   string;
  mfaRequired:        boolean;
};

const SECURITY_DEFAULTS: SecuritySettings = {
  passwordMinLength:  8,
  passwordComplexity: 'medium',
  sessionMaxHours:    8,
  lockoutMaxAttempts: 0,
  lockoutMinutes:     15,
  passwordHistoryCount: 0,
  passwordExpiryDays:   0,
  maxConcurrentSessions:    0,
  inactivityTimeoutMinutes: 0,
  tlsEnforce:         false,
  ipAllowlistEnabled: false,
  ipAllowlistCidrs:   '',
  mfaRequired:        false,
};

function SecurityTab({ isAdmin }: { isAdmin: boolean }) {
  const { t: tr } = useTranslation();
  const [settings, setSettings]   = useState(SECURITY_DEFAULTS);
  const [loading, setLoading]     = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg]       = useState('');

  useEffect(() => {
    let alive = true;
    getPlatform()
      .then((d) => {
        if (alive) setSettings({
          passwordMinLength:  d.passwordMinLength  ?? 8,
          passwordComplexity: d.passwordComplexity ?? 'medium',
          sessionMaxHours:    d.sessionMaxHours    ?? 8,
          lockoutMaxAttempts: d.lockoutMaxAttempts ?? 0,
          lockoutMinutes:     d.lockoutMinutes     ?? 15,
          passwordHistoryCount: d.passwordHistoryCount ?? 0,
          passwordExpiryDays:   d.passwordExpiryDays   ?? 0,
          maxConcurrentSessions:    d.maxConcurrentSessions    ?? 0,
          inactivityTimeoutMinutes: d.inactivityTimeoutMinutes ?? 0,
          tlsEnforce:         d.tlsEnforce         ?? false,
          ipAllowlistEnabled: d.ipAllowlistEnabled ?? false,
          ipAllowlistCidrs:   d.ipAllowlistCidrs   ?? '',
          mfaRequired:        d.mfaRequired        ?? false,
        });
      })
      .catch(() => { if (alive) setErrMsg(i18n.t('settings.securityLoadFailed2')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const handleSave = async () => {
    setSaveState('saving');
    setErrMsg('');
    try {
      const current = await getPlatform();
      await savePlatform({ ...current, ...settings });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : tr('common.savingFailed'));
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  // Score wird live aus den echten Einstellungen abgeleitet (kein Hardcode).
  const posture = computeSecurityPosture(settings);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Security Posture (obere Karten-Reihe) ── */}
      {!loading && <SecurityPostureCards posture={posture} />}

      {/* ── Hauptbereich: 3-Spalten ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* Spalte 1: Passwortrichtlinie + Anmelde-Sicherheit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <Card>
            <CardHeader
              title={tr('settings.passwordSessionPolicy2')}
              actions={<Badge tone="success" dot>{tr('common.active')}</Badge>}
            />
            <CardBody>
              {loading ? <Spinner /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--accent) 4%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    marginBottom: 2,
                  }}>
                    <SectionLabel accent>{tr('settings.serverEnforced')}</SectionLabel>
                  </div>

                  <SettingsRow label={tr('settings.minPasswordLength2')}>
                    <Input
                      type="number"
                      value={String(settings.passwordMinLength)}
                      min={8}
                      max={128}
                      disabled={!isAdmin}
                      onChange={(e) => setSettings((s) => ({ ...s, passwordMinLength: Number(e.target.value) }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={tr('settings.complexity2')}>
                    <Select
                      value={settings.passwordComplexity}
                      disabled={!isAdmin}
                      options={[
                        { value: 'low',    label: tr('settings.complexityLowLabel') },
                        { value: 'medium', label: 'Mittel (Buchstabe + Ziffer)' },
                        { value: 'high',   label: tr('settings.complexityHighLabel') },
                      ]}
                      onChange={(e) => setSettings((s) => ({ ...s, passwordComplexity: e.target.value as PlatformSettings['passwordComplexity'] }))}
                    />
                  </SettingsRow>
                  <SettingsRow label="Max. Sitzungsdauer (h)">
                    <Input
                      type="number"
                      value={String(settings.sessionMaxHours)}
                      min={1}
                      max={168}
                      disabled={!isAdmin}
                      onChange={(e) => setSettings((s) => ({ ...s, sessionMaxHours: Number(e.target.value) }))}
                    />
                  </SettingsRow>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    <SettingsRow label={tr('settings.historyLockN')}>
                      <Input
                        type="number"
                        value={String(settings.passwordHistoryCount)}
                        min={0}
                        max={50}
                        disabled={!isAdmin}
                        title={tr('settings.passwordHistoryHint')}
                        onChange={(e) => setSettings((s) => ({ ...s, passwordHistoryCount: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                    <SettingsRow label="Ablauf (Tage)">
                      <Input
                        type="number"
                        value={String(settings.passwordExpiryDays)}
                        min={0}
                        max={3650}
                        disabled={!isAdmin}
                        title={tr('settings.passwordExpiryHint')}
                        onChange={(e) => setSettings((s) => ({ ...s, passwordExpiryDays: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10, marginTop: 2 }}>
                    <SectionLabel>Sitzungs-Richtlinie</SectionLabel>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    <SettingsRow label={tr('settings.maxSessionsPerUser')}>
                      <Input
                        type="number"
                        value={String(settings.maxConcurrentSessions)}
                        min={0}
                        max={100}
                        disabled={!isAdmin}
                        title={tr('settings.maxSessionsHint')}
                        onChange={(e) => setSettings((s) => ({ ...s, maxConcurrentSessions: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                    <SettingsRow label={tr('settings.inactivityMinutes')}>
                      <Input
                        type="number"
                        value={String(settings.inactivityTimeoutMinutes)}
                        min={0}
                        max={1440}
                        disabled={!isAdmin}
                        title={tr('settings.inactivityHint')}
                        onChange={(e) => setSettings((s) => ({ ...s, inactivityTimeoutMinutes: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                  </div>

                  {errMsg && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{errMsg}</div>}
                  {isAdmin && (
                    <Button
                      variant={saveState === 'saved' ? 'success' : 'primary'}
                      size="sm"
                      onClick={handleSave}
                      disabled={saveState === 'saving'}
                    >
                      {saveState === 'saving' ? tr('text.saving')
                        : saveState === 'saved' ? tr('common.savedCheck')
                        : tr('settings.savePolicy2')}
                    </Button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={tr('settings.loginSecurity2')}
              actions={
                settings.lockoutMaxAttempts > 0
                  ? <Badge tone="success" dot>{tr('common.active')}</Badge>
                  : <Badge>{tr('settings.off2')}</Badge>
              }
            />
            <CardBody>
              {loading ? <Spinner /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--accent) 4%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                  }}>
                    <SectionLabel accent>{tr('settings.serverEnforcedLockout')}</SectionLabel>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    <SettingsRow label={helpLabel('Max. Fehlversuche', (
                      <ExampleHint
                        title={tr('settings.lockoutThresholdLabel')}
                        text={tr('settings.lockoutThresholdHint')}
                        exampleLabel="Sinnvoller Startwert"
                        rows={[
                          { label: tr('common.value'), value: '5' },
                          { label: tr('common.meaning'), value: tr('settings.lockAfterFive') },
                        ]}
                        footer={tr('settings.lockoutThresholdExample')}
                      />
                    ))}>
                      <Input
                        type="number"
                        value={String(settings.lockoutMaxAttempts)}
                        min={0}
                        max={100}
                        disabled={!isAdmin}
                        title={tr('settings.zeroDisablesLockout')}
                        onChange={(e) => setSettings((s) => ({ ...s, lockoutMaxAttempts: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                    <SettingsRow label={helpLabel('Sperrdauer (Min.)', (
                      <ExampleHint
                        title={tr('settings.lockoutDurationLabel')}
                        text={tr('settings.lockoutDurationHint')}
                        exampleLabel={tr('common.typicalValue')}
                        rows={[
                          { label: 'Minuten', value: '15' },
                          { label: 'Praxis', value: 'kurze Schutzsperre' },
                        ]}
                        footer={tr('settings.sessionLengthTradeoff')}
                      />
                    ))}>
                      <Input
                        type="number"
                        value={String(settings.lockoutMinutes)}
                        min={1}
                        max={1440}
                        disabled={!isAdmin || settings.lockoutMaxAttempts === 0}
                        onChange={(e) => setSettings((s) => ({ ...s, lockoutMinutes: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    {settings.lockoutMaxAttempts === 0
                      ? tr('settings.lockoutDisabledHint')
                      : tr('settings.lockoutSummary', { attempts: settings.lockoutMaxAttempts, minutes: settings.lockoutMinutes })}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
                    <SectionLabel>{tr('settings.plannedNotEnforced')}</SectionLabel>
                  </div>
                  <ToggleRow label={tr('settings.captchaOnLockout')}          desc={tr('settings.plannedNotEnforced')} checked={false} onChange={() => {}} disabled />
                  <ToggleRow label={tr('settings.notifyOnLockout')} desc={tr('settings.plannedNotEnforced')} checked={false} onChange={() => {}} disabled />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Spalte 2: Zugriffskontrolle + Security-Standards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader
              title="Zugriffskontrolle"
              actions={
                (settings.tlsEnforce || settings.ipAllowlistEnabled)
                  ? <Badge tone="success" dot>{tr('settings.partlyActive2')}</Badge>
                  : <Badge>{tr('settings.off2')}</Badge>
              }
            />
            <CardBody>
              {loading ? <Spinner /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--accent) 4%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                  }}>
                    <SectionLabel accent>{tr('settings.serverEnforced')}</SectionLabel>
                  </div>

                  <ToggleRow
                    label={helpLabel('TLS erzwingen', tr('settings.tlsHint'))}
                    desc={tr('settings.rejectPlainHttp')}
                    checked={settings.tlsEnforce}
                    onChange={(v) => setSettings((s) => ({ ...s, tlsEnforce: v }))}
                    disabled={!isAdmin}
                  />

                  <ToggleRow
                    label={helpLabel('IP-Allowlist', (
                      <ExampleHint
                        title={tr('settings.allowlistLabel')}
                        text={tr('settings.allowlistHint')}
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'Office', value: '10.0.0.0/8' },
                          { label: 'SOC-VLAN', value: '192.168.241.0/24' },
                        ]}
                        footer={tr('settings.allowlistExample')}
                      />
                    ))}
                    desc={tr('settings.apiOnlyFromAllowlist')}
                    checked={settings.ipAllowlistEnabled}
                    onChange={(v) => setSettings((s) => ({ ...s, ipAllowlistEnabled: v }))}
                    disabled={!isAdmin}
                  />

                  {settings.ipAllowlistEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <SettingsRow label={helpLabel('Erlaubte CIDRs', tr('settings.allowlistFormat'))} compact>
                        <textarea
                          value={settings.ipAllowlistCidrs}
                          disabled={!isAdmin}
                          onChange={(e) => setSettings((s) => ({ ...s, ipAllowlistCidrs: e.target.value }))}
                          placeholder="10.0.0.0/8, 192.168.241.0/24"
                          rows={2}
                          style={{
                            width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 11.5,
                            background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border-soft)',
                            borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                          }}
                        />
                      </SettingsRow>
                      <div style={{ fontSize: 10.5, color: 'var(--warning)', lineHeight: 1.5 }}>{tr('settings.allowlistWarn')}</div>
                    </div>
                  )}

                  {/* Org-weite MFA-Pflicht — echt durchgesetzt (greift nur bei aktivem MFA-Gate) */}
                  <ToggleRow
                    label={helpLabel(tr('settings.mfaMandatoryAll'), (
                      <ExampleHint
                        title={tr('settings.mfaLabel')}
                        text={tr('settings.mfaHint')}
                        exampleLabel="Typischer Rollout"
                        rows={[
                          { label: tr('settings.pilot'), value: tr('text.administratorsFirst') },
                          { label: tr('settings.afterwards'), value: tr('settings.allUsers') },
                        ]}
                        footer={tr('settings.mfaExample')}
                      />
                    ))}
                    desc={tr('settings.mfaDescription2')}
                    checked={settings.mfaRequired}
                    onChange={(v) => setSettings((s) => ({ ...s, mfaRequired: v }))}
                    disabled={!isAdmin}
                  />

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                    <SectionLabel>{tr('settings.plannedNotEnforced')}</SectionLabel>
                  </div>
                  <ToggleRow label="WebAuthn / Hardware-Key"       desc={tr('settings.fido2Planned')}            checked={false} onChange={() => {}} disabled />

                  {isAdmin && (
                    <Button
                      variant={saveState === 'saved' ? 'success' : 'primary'}
                      size="sm"
                      onClick={handleSave}
                      disabled={saveState === 'saving'}
                    >
                      {saveState === 'saving' ? tr('text.saving')
                        : saveState === 'saved' ? tr('common.savedCheck')
                        : tr('settings.saveAccessControl')}
                    </Button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <SecurityStandardsCard />

          <OidcSettingsCard isAdmin={isAdmin} />
        </div>

        {/* Spalte 3 (rechts): Score + Events + Passwort ändern */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!loading && <SecurityScoreCard posture={posture} />}
          <SecurityEventsFeed />
          <MfaSecurityCard />
          <ChangePasswordCard />
        </div>
      </div>
    </div>
  );
}

// ── Hilfskarte: Security-Standards (informativ, kein "erzwungen") ─────────────

function SecurityStandardsCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader
        title="Security-Standards & Compliance"
        actions={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
            <Info size={12} />{tr('settings.orientationOnly')}</span>
        }
      />
      <CardBody>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>{tr('settings.standardsCardNote')}</div>
        {[
          { std: 'NIST 800-63B', hint: tr('settings.passwordRecommendation') },
          { std: 'CIS Controls',  hint: tr('settings.mfaRecommendation') },
          { std: 'OWASP ASVS',   hint: tr('settings.historyRateLimitInvalidation') },
        ].map(({ std, hint }) => (
          <div key={std} style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{std}</span>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{hint}</div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

// ── Passwort ändern (für den eigenen Account) ─────────────────────────────────

function ChangePasswordCard() {
  const { t: tr } = useTranslation();
  const [current, setCurrent]    = useState('');
  const [next, setNext]          = useState('');
  const [confirm, setConfirm]    = useState('');
  const [busy, setBusy]          = useState(false);
  const [error, setError]        = useState('');
  const [done, triggerDone]      = useAutoResetFlag(3000);

  async function submit() {
    const ce = validatePasswordChange(current, next, confirm);
    if (ce) { setError(ce); return; }
    setBusy(true);
    setError('');
    try {
      await authApi.changePassword(current, next);
      triggerDone();
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('app.passwordChangeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Lock size={14} />{tr('settings.changeOwnPassword')}</span>
      } />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label={tr('settings.currentPassword')}>
            <Input type="password" name="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label={tr('label.newPassword')}>
            <Input type="password" name="new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label={tr('app.confirmNewPassword')}>
            <Input type="password" name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          {done  && <div style={{ fontSize: 12, color: 'var(--success)' }}>{tr('app.passwordChanged')}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{tr('settings.lastPasswordChange')}<strong>—</strong>
            <span
              title={tr('settings.dateLastChangeNotTracked')}
              style={{ marginLeft: 4, cursor: 'help' }}
            >
              (nicht getrackt)
            </span>
          </div>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? tr('app.changing') : tr('app.changePassword')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Hilfskomponente: Section-Label ────────────────────────────────────────────

function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      color: accent ? 'var(--accent)' : 'var(--text-dim)',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 2,
    }}>
      {children}
    </div>
  );
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={LABEL}>{k}</div>
      <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text)' }}>{v}</div>
    </div>
  );
}

function SettingsRow({ label, children, compact }: { label: ReactNode; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '120px 1fr', gap: compact ? 2 : 8, alignItems: 'center' }}>
      <div style={{ fontSize: compact ? 10 : 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

// Ehrlicher Verweis auf einen anderen Settings-Tab (keine Fake-Kontrolle).
function CrossRef({ label, target }: { label: string; target: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Tab „{target}"
      </span>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4, borderBottom: '1px solid var(--border-soft)', paddingBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange, disabled, compact }: {
  label: ReactNode; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; compact?: boolean;
}) {
  const { t: tr } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: compact ? 12 : 13, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{desc}</div>}
      </div>
      <Toggle checked={checked} onChange={disabled ? () => undefined : onChange} label={typeof label === 'string' ? label : tr('text.setting')} />
    </div>
  );
}

const LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)' };
const HELP_LABEL: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const HELP_BULB: CSSProperties = { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' };

function helpLabel(text: string, hint: ReactNode): ReactNode {
  return (
    <span style={HELP_LABEL}>
      <span>{text}</span>
      <HelpTip topic="system" hint={hint}>
        <span style={HELP_BULB} aria-label={`${text} erklaeren`}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}
