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
import { changeLanguage } from '../i18n';

interface HealthResponse { status: string; service: string; version: string; env: string; uptime: number; db?: string; }

type TabDef = { id: string; label: string; icon: React.ReactNode; minRole?: 'admin' | 'engineer' | 'analyst' };

const TABS: TabDef[] = [
  { id: 'general',       label: 'Allgemein',               icon: <Server size={13} /> },
  { id: 'users',         label: 'Benutzer & Rollen',       icon: <Users size={13} />,   minRole: 'admin' },
  { id: 'security',      label: 'Sicherheit',              icon: <Shield size={13} />,  minRole: 'admin' },
  { id: 'notifications', label: 'Benachrichtigungen',      icon: <Bell size={13} />,    minRole: 'admin' },
  { id: 'retention',     label: 'Speicherung & Retention', icon: <Database size={13} />,minRole: 'admin' },
  { id: 'branding',      label: 'Branding / Thema',        icon: <Palette size={13} />, minRole: 'admin' },
  // 'Threat Hunting' + 'Audit & Compliance' liegen jetzt in ihren Bereichen:
  // /hunting/settings (Hunting) bzw. /compliance/audit (Compliance) — nicht mehr hier.
];

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const role = user?.role;

  const visibleTabs = TABS.filter((t) => !t.minRole || hasRole(role, t.minRole));
  const [tab, setTab] = useState(() => {
    const first = TABS.filter((t) => !t.minRole || hasRole(role, t.minRole))[0];
    return first?.id ?? 'general';
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>Systemeinstellungen<HelpTip topic="benutzer-rollen" /></h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '4px 0 0' }}>
            Konfigurieren Sie Ihre SOC-Plattform und verwalten Sie Integrationen, Benutzer, Sicherheit und mehr.
          </p>
        </div>
        {/* Export-Button: noch kein API-Endpunkt — disabled mit erklärendem Tooltip */}
        <Button
          variant="ghost"
          icon={<Download size={14} />}
          disabled
          title="Export-Funktion folgt in einem späteren Release"
        >
          Einstellungen exportieren
        </Button>
      </div>

      {/* Tab Bar */}
      <div role="tablist" aria-label="Systemeinstellungen" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 24, overflowX: 'auto' }}>
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
  language:           'en',
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
  const [settings, setSettings]   = useState<PlatformSettings>(PLATFORM_DEFAULTS);
  const [loading, setLoading]     = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg]       = useState('');

  useEffect(() => {
    let alive = true;
    getPlatform()
      .then((d) => { if (alive) setSettings(d); })
      .catch(() => { if (alive) setErrMsg('Einstellungen konnten nicht geladen werden.'); })
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
      void changeLanguage(saved.language);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Speichern fehlgeschlagen.';
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
              title="Plattform-Informationen"
              actions={!loading && settings.platformName ? <Badge>{settings.platformName}</Badge> : undefined}
            />
            <CardBody>
              {loading ? <Spinner /> : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                  <SettingsRow label={helpLabel('Plattformname', (
                    <ExampleHint
                      title="Name der sichtbaren Nexora-Instanz"
                      text="So erscheint das System spaeter in Titel, Navigation und internen Bezugsstellen."
                      exampleLabel="Typischer Eintrag"
                      rows={[
                        { label: 'Name', value: 'Nexora SOC Frankfurt' },
                        { label: 'Kurzform', value: 'Nexora SOC' },
                      ]}
                      footer="Nimm einen Namen, den dein Team im Alltag wirklich benutzt."
                    />
                  ))}>
                    <Input
                      value={settings.platformName}
                      disabled={!isAdmin}
                      onChange={(e) => setSettings((s) => ({ ...s, platformName: e.target.value }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel('Zeitzone', (
                    <ExampleHint
                      title="In welcher Zeit Nexora Daten darstellt"
                      text="Die Zeitzone bestimmt, wie Zeiten in Tickets, Hunts und Logs angezeigt werden."
                      exampleLabel="Beispiel"
                      rows={[
                        { label: 'Team in DE', value: 'Europe/Berlin' },
                        { label: 'Neutral', value: 'UTC' },
                      ]}
                      footer="Waehle die Zone des operativen Teams, sonst wirken Fristen und Eventzeiten schnell falsch."
                    />
                  ))}>
                    <Select
                      value={settings.timezone}
                      disabled={!isAdmin}
                      options={[
                        { value: 'Europe/Berlin', label: '(UTC+02:00) Europe/Berlin' },
                        { value: 'UTC',           label: 'UTC' },
                        { value: 'US/Eastern',    label: '(UTC-05:00) US Eastern' },
                      ]}
                      onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel('Sprache', 'Das ist die Standardsprache der Oberflaeche fuer Menues und Bedientexte.')}>
                    <Select
                      value={settings.language}
                      disabled={!isAdmin}
                      options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]}
                      onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value as PlatformSettings['language'] }))}
                    />
                  </SettingsRow>
                  <SettingsRow label={helpLabel('Standard-Ansicht', (
                    <ExampleHint
                      title="Wo neue Sitzungen landen"
                      text="Diese Ansicht oeffnet Nexora standardmaessig direkt nach dem Login."
                      exampleLabel="Typischer Start"
                      rows={[
                        { label: 'Tier-1-Team', value: 'Dashboard' },
                        { label: 'Bearbeitungsteam', value: 'Tickets' },
                      ]}
                      footer="Nimm die Seite, auf der euer Team wirklich jeden Tag zuerst arbeitet."
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
                      label={helpLabel('Wartungsmodus', (
                        <ExampleHint
                          title="System kurz fuer normale Nutzer sperren"
                          text="Damit blockierst du regulaere Arbeit, solange Wartung oder ein kontrollierter Umbau laeuft."
                          exampleLabel="Typischer Einsatz"
                          rows={[
                            { label: 'Situation', value: 'DB-Migration / Upgrade' },
                            { label: 'Wirkung', value: 'Nur Admins arbeiten weiter' },
                          ]}
                          footer="Nur einschalten, wenn du die Wartung bewusst kommuniziert hast."
                        />
                      ))}
                      desc="Plattform für normale Benutzer sperren (503)"
                      checked={settings.maintenanceMode}
                      onChange={(v) => setSettings((s) => ({ ...s, maintenanceMode: v }))}
                      disabled={!isAdmin}
                    />
                    <ToggleRow
                      label={helpLabel('Feature-Vorschau aktivieren', 'Schaltet bewusst fruehe oder noch nicht final abgesicherte Funktionen fuer Admin-Tests frei.')}
                      desc="Zugriff auf Beta-Funktionen"
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
                        {saveState === 'saving' ? 'Wird gespeichert …'
                          : saveState === 'saved' ? '✓ Gespeichert'
                          : 'Speichern'}
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
              title="Verwandte Einstellungen"
              actions={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                  <Info size={12} /> Wo wird was konfiguriert
                </span>
              }
            />
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <SettingsGroup title="Authentifizierung & Zugriff">
                  <CrossRef label="Passwort- & Sitzungsrichtlinie, Account-Lockout" target="Sicherheit" />
                  <CrossRef label="Benutzer & Rollen (RBAC)" target="Benutzer & Rollen" />
                  <CrossRef label="SSO / OpenID Connect (Issuer, Client, Aktivierung)" target="Sicherheit" />
                </SettingsGroup>

                <SettingsGroup title="Daten & Aufbewahrung">
                  <CrossRef label="Speichergröße, Backup & Retention" target="Speicherung & Retention" />
                  <CrossRef label="Audit-Aktivität & Compliance" target="Audit & Compliance" />
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
        <EmptyState title="API nicht erreichbar" message="Backend prüfen." />
      </div>
    );
  }

  const tiles = health ? [
    { label: 'API-Status',    value: health.status === 'ok' ? 'Online' : health.status, sub: health.service, color: health.status === 'ok' ? 'var(--success)' : 'var(--warning)', icon: <Server size={18} /> },
    { label: 'Datenbank',     value: health.db === 'ok' ? 'Verbunden' : 'Prüfen',       sub: 'PostgreSQL',   color: health.db === 'ok' ? 'var(--success)' : 'var(--warning)',  icon: <Activity size={18} /> },
    { label: 'Version',       value: health.version,                                    sub: health.env,     color: 'var(--accent)',                                             icon: <CheckCircle size={18} /> },
    { label: 'Uptime',        value: fmtUptime(health.uptime),                          sub: 'Laufzeit',     color: 'var(--success)',                                            icon: <RefreshCw size={18} /> },
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
      <CardHeader title="Lizenz & Nutzung" />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <KV k="Edition"       v={<Badge tone="accent">Community</Badge>} />
            <KV k="Lizenzstatus"  v={<Badge tone="success" dot>Aktiv</Badge>} />
            <KV k="Gültig bis"    v="Open Source" />
          </div>

          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <KV k="Benutzer"          v={fmt(users)} />
            <KV k="Datensätze gesamt" v={fmt(records)} />
            <KV k="Datenbankgröße"    v={error ? '—' : (typeof dbBytes === 'number' ? formatBytes(dbBytes) : '…')} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Echte Werte aus der Datenbank — keine Nutzer- oder Speichergrenze in der Community-Edition.
          </div>
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
      .catch(() => { if (alive) setErrMsg('Sicherheitseinstellungen konnten nicht geladen werden.'); })
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
      setErrMsg(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
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
              title="Passwort- und Sitzungsrichtlinie"
              actions={<Badge tone="success" dot>Aktiv</Badge>}
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
                    <SectionLabel accent>Serverseitig erzwungen</SectionLabel>
                  </div>

                  <SettingsRow label="Min. Passwortlänge">
                    <Input
                      type="number"
                      value={String(settings.passwordMinLength)}
                      min={8}
                      max={128}
                      disabled={!isAdmin}
                      onChange={(e) => setSettings((s) => ({ ...s, passwordMinLength: Number(e.target.value) }))}
                    />
                  </SettingsRow>
                  <SettingsRow label="Komplexität">
                    <Select
                      value={settings.passwordComplexity}
                      disabled={!isAdmin}
                      options={[
                        { value: 'low',    label: 'Niedrig (nur Länge)' },
                        { value: 'medium', label: 'Mittel (Buchstabe + Ziffer)' },
                        { value: 'high',   label: 'Hoch (Groß + Klein + Ziffer + Sonderzeichen)' },
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
                    <SettingsRow label="History-Sperre (N)">
                      <Input
                        type="number"
                        value={String(settings.passwordHistoryCount)}
                        min={0}
                        max={50}
                        disabled={!isAdmin}
                        title="Wiederverwendung der letzten N Passwörter sperren (0 = aus)"
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
                        title="Passwort nach N Tagen erzwungen wechseln (0 = aus)"
                        onChange={(e) => setSettings((s) => ({ ...s, passwordExpiryDays: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10, marginTop: 2 }}>
                    <SectionLabel>Sitzungs-Richtlinie</SectionLabel>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    <SettingsRow label="Max. Sitzungen / Nutzer">
                      <Input
                        type="number"
                        value={String(settings.maxConcurrentSessions)}
                        min={0}
                        max={100}
                        disabled={!isAdmin}
                        title="Älteste Sitzung wird bei Überschreiten abgemeldet (0 = unbegrenzt)"
                        onChange={(e) => setSettings((s) => ({ ...s, maxConcurrentSessions: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                    <SettingsRow label="Inaktivität (Min.)">
                      <Input
                        type="number"
                        value={String(settings.inactivityTimeoutMinutes)}
                        min={0}
                        max={1440}
                        disabled={!isAdmin}
                        title="Automatische Abmeldung nach Inaktivität (0 = aus)"
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
                      {saveState === 'saving' ? 'Wird gespeichert …'
                        : saveState === 'saved' ? '✓ Gespeichert'
                        : 'Richtlinie speichern'}
                    </Button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Anmelde-Sicherheit"
              actions={
                settings.lockoutMaxAttempts > 0
                  ? <Badge tone="success" dot>Aktiv</Badge>
                  : <Badge>Aus</Badge>
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
                    <SectionLabel accent>Serverseitig erzwungen — Account-Lockout</SectionLabel>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                    <SettingsRow label={helpLabel('Max. Fehlversuche', (
                      <ExampleHint
                        title="Ab wann ein Konto gesperrt wird"
                        text="Nach so vielen falschen Logins sperrt Nexora den Account temporaer."
                        exampleLabel="Sinnvoller Startwert"
                        rows={[
                          { label: 'Wert', value: '5' },
                          { label: 'Bedeutung', value: 'Sperre nach 5 Fehlversuchen' },
                        ]}
                        footer="0 bedeutet komplett aus. Fuer produktive Umgebungen ist ein positiver Wert meist sinnvoller."
                      />
                    ))}>
                      <Input
                        type="number"
                        value={String(settings.lockoutMaxAttempts)}
                        min={0}
                        max={100}
                        disabled={!isAdmin}
                        title="0 = Account-Lockout deaktiviert"
                        onChange={(e) => setSettings((s) => ({ ...s, lockoutMaxAttempts: Number(e.target.value) }))}
                      />
                    </SettingsRow>
                    <SettingsRow label={helpLabel('Sperrdauer (Min.)', (
                      <ExampleHint
                        title="Wie lange ein gesperrtes Konto warten muss"
                        text="Die Dauer bestimmt, wann ein Nutzer nach zu vielen Fehlversuchen wieder hinein darf."
                        exampleLabel="Typischer Wert"
                        rows={[
                          { label: 'Minuten', value: '15' },
                          { label: 'Praxis', value: 'kurze Schutzsperre' },
                        ]}
                        footer="Zu kurz bringt wenig Schutz, zu lang fuehrt schnell zu Support-Aufwand."
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
                      ? 'Lockout ist deaktiviert (0). Bei einem Wert > 0 wird ein Konto nach so vielen Fehlversuchen für die Sperrdauer gesperrt.'
                      : `Konto wird nach ${settings.lockoutMaxAttempts} Fehlversuchen für ${settings.lockoutMinutes} Min. gesperrt. Speichern über „Richtlinie speichern“ links.`}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
                    <SectionLabel>Geplant — nicht erzwungen</SectionLabel>
                  </div>
                  <ToggleRow label="CAPTCHA bei Sperrung"          desc="Geplant — nicht erzwungen" checked={false} onChange={() => {}} disabled />
                  <ToggleRow label="Benachrichtigung bei Sperrung" desc="Geplant — nicht erzwungen" checked={false} onChange={() => {}} disabled />
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
                  ? <Badge tone="success" dot>Teilweise aktiv</Badge>
                  : <Badge>Aus</Badge>
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
                    <SectionLabel accent>Serverseitig erzwungen</SectionLabel>
                  </div>

                  <ToggleRow
                    label={helpLabel('TLS erzwingen', 'Erlaubt nur verschluesselte Verbindungen. Unverschluesseltes HTTP wird abgelehnt.')}
                    desc="Unverschlüsselte (HTTP-)Verbindungen ablehnen"
                    checked={settings.tlsEnforce}
                    onChange={(v) => setSettings((s) => ({ ...s, tlsEnforce: v }))}
                    disabled={!isAdmin}
                  />

                  <ToggleRow
                    label={helpLabel('IP-Allowlist', (
                      <ExampleHint
                        title="Welche Netze die API ueberhaupt erreichen duerfen"
                        text="Nur Zugriffe aus diesen erlaubten Netzen kommen durch, alles andere wird abgewiesen."
                        exampleLabel="Beispiel"
                        rows={[
                          { label: 'Office', value: '10.0.0.0/8' },
                          { label: 'SOC-VLAN', value: '192.168.241.0/24' },
                        ]}
                        footer="Trage nur Netze ein, aus denen Admins und Integrationen die API wirklich nutzen muessen."
                      />
                    ))}
                    desc="API-Zugriff nur aus erlaubten IP-Bereichen"
                    checked={settings.ipAllowlistEnabled}
                    onChange={(v) => setSettings((s) => ({ ...s, ipAllowlistEnabled: v }))}
                    disabled={!isAdmin}
                  />

                  {settings.ipAllowlistEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <SettingsRow label={helpLabel('Erlaubte CIDRs', 'Kommagetrennte IPv4-Netze im CIDR-Format, zum Beispiel 10.0.0.0/8.')} compact>
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
                      <div style={{ fontSize: 10.5, color: 'var(--warning)', lineHeight: 1.5 }}>
                        ⚠ Achtung: Eine falsche Liste sperrt dich selbst aus der API aus. Leere Liste = alle erlaubt.
                        Nur IPv4/CIDR, kommagetrennt. /health bleibt immer erreichbar.
                      </div>
                    </div>
                  )}

                  {/* Org-weite MFA-Pflicht — echt durchgesetzt (greift nur bei aktivem MFA-Gate) */}
                  <ToggleRow
                    label={helpLabel('MFA-Pflicht fuer alle Benutzer (TOTP)', (
                      <ExampleHint
                        title="Zwingt jeden Benutzer zu einem zweiten Faktor"
                        text="Beim naechsten Login muessen Benutzer MFA einrichten, bevor sie normal weiterarbeiten."
                        exampleLabel="Typischer Rollout"
                        rows={[
                          { label: 'Pilot', value: 'erst Admins' },
                          { label: 'Danach', value: 'alle Benutzer' },
                        ]}
                        footer="Nur aktivieren, wenn MFA serverseitig schon bereitsteht und intern angekuendigt wurde."
                      />
                    ))}
                    desc="Jeder Benutzer muss beim nächsten Login MFA einrichten. Greift nur, wenn MFA serverseitig aktiviert ist (MFA_ENABLED)."
                    checked={settings.mfaRequired}
                    onChange={(v) => setSettings((s) => ({ ...s, mfaRequired: v }))}
                    disabled={!isAdmin}
                  />

                  <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                    <SectionLabel>Geplant — nicht erzwungen</SectionLabel>
                  </div>
                  <ToggleRow label="WebAuthn / Hardware-Key"       desc="FIDO2-Authenticator — geplant"            checked={false} onChange={() => {}} disabled />

                  {isAdmin && (
                    <Button
                      variant={saveState === 'saved' ? 'success' : 'primary'}
                      size="sm"
                      onClick={handleSave}
                      disabled={saveState === 'saving'}
                    >
                      {saveState === 'saving' ? 'Wird gespeichert …'
                        : saveState === 'saved' ? '✓ Gespeichert'
                        : 'Zugriffskontrolle speichern'}
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
  return (
    <Card>
      <CardHeader
        title="Security-Standards & Compliance"
        actions={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
            <Info size={12} /> Nur zur Orientierung
          </span>
        }
      />
      <CardBody>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>
          Diese Karte zeigt Orientierungswerte aus gängigen Security-Standards —
          sie ist rein informativ und impliziert keine Zertifizierung oder Erzwingung.
        </div>
        {[
          { std: 'NIST 800-63B', hint: 'Empf. ≥ 8 Zeichen, kein erzwungener Ablauf, MFA wo möglich' },
          { std: 'CIS Controls',  hint: 'MFA für Admins, Passwort-Manager, least-privilege Rollen' },
          { std: 'OWASP ASVS',   hint: 'Passwort-History, Rate-Limiting, Session-Invalidierung' },
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
      setError(err instanceof Error ? err.message : 'Passwortänderung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Lock size={14} /> Eigenes Passwort ändern
        </span>
      } />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Aktuelles Passwort">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Neues Passwort">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Neues Passwort bestätigen">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          {done  && <div style={{ fontSize: 12, color: 'var(--success)' }}>Passwort geändert ✓</div>}
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Letzte Passwortänderung: <strong>—</strong>
            <span
              title="Datum der letzten Änderung wird serverseitig nicht pro Benutzer getrackt"
              style={{ marginLeft: 4, cursor: 'help' }}
            >
              (nicht getrackt)
            </span>
          </div>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Wird geändert …' : 'Passwort ändern'}
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: compact ? 12 : 13, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{desc}</div>}
      </div>
      <Toggle checked={checked} onChange={disabled ? () => undefined : onChange} label={typeof label === 'string' ? label : 'Einstellung'} />
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
