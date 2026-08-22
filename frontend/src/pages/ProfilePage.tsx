import { useState, useEffect } from 'react';
import { useAutoResetFlag } from '../hooks/useAutoResetFlag';
import {
  Mail, Calendar, Clock, Lock, Palette, Monitor, Sun, Moon, Check,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { validatePasswordChange } from '../features/auth/passwordChangeModel';
import { authApi } from '../features/auth/authApi';
import {
  profileApi,
  type UserProfile,
  type ProfileFeatures,
  type Language,
  type DateFormat,
} from '../features/profile/profileApi';
import {
  SectionHeader, Card, CardHeader, CardBody, Button, Field, Input, Select,
} from '../components/ui';
import { MfaSecurityCard } from '../features/mfa/MfaSecurityCard';
import { ApiTokensCard } from '../features/settings/components/ApiTokensCard';
import { WebAuthnCard } from '../features/auth/WebAuthnCard';
import { changeLanguage } from '../i18n';

const PASSWORD_REQS = ['Mindestens 8 Zeichen', 'Groß- und Kleinbuchstaben', 'Mindestens eine Zahl', 'Mindestens ein Sonderzeichen'];
const THEME_KEY = 'soc_theme';

function applyTheme(theme: string) {
  // theme '' oder 'dark' → keine light-Klasse; 'light' → light-Klasse.
  // 'system' folgt der OS-Präferenz (prefers-color-scheme); die rohe Präferenz
  // wird gespeichert, angewendet wird das aufgelöste Ergebnis.
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  if (effective === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
  localStorage.setItem(THEME_KEY, theme);
}

function initials(name?: string, email?: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

export function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [features, setFeatures] = useState<ProfileFeatures | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Aktives Theme aus Profil — lade initial aus localStorage als Fallback
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) ?? '');

  // Profil + Feature-Flags beim Mount laden (ein Request)
  useEffect(() => {
    let active = true;
    profileApi.getProfileWithFeatures().then(({ profile: p, features: f }) => {
      if (!active) return;
      setProfile(p);
      setFeatures(f);
      // Theme aus Backend übernehmen + lokal anwenden
      if (p.theme !== undefined) {
        setTheme(p.theme);
        applyTheme(p.theme);
      }
    }).catch(() => { if (active) setLoadError(true); /* Fallback auf JWT-User; MFA/PAT-Status ggf. unbekannt */ });
    return () => { active = false; };
  }, []);

  // Theme wechseln: sofort lokal anwenden + serverseitig persistieren
  function handleThemeChange(newTheme: string) {
    setTheme(newTheme);
    applyTheme(newTheme);
    profileApi.updateProfile({ theme: newTheme }).then((updated) => {
      setProfile(updated);
    }).catch(() => { /* best-effort */ });
  }

  const displayName  = profile?.displayName ?? user?.displayName ?? '';
  const email        = profile?.email       ?? user?.email        ?? '';
  const role         = profile?.role        ?? user?.role         ?? '';
  const phone        = profile?.phone       ?? '';
  const language     = profile?.language    ?? 'en';
  const dateFormat   = profile?.dateFormat  ?? 'dmy';

  const lastName  = displayName.split(' ').slice(1).join(' ');
  const firstName = displayName.split(' ')[0] ?? '';

  return (
    <div>
      <SectionHeader title="Profil" subtitle="Benutzerprofil und persönliche Einstellungen" help="profile" />

      {loadError && (
        <div role="alert" style={{ marginBottom: 16, padding: '8px 12px', fontSize: 12.5, borderRadius: 'var(--radius-sm)', color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
          Profil konnte nicht vollständig geladen werden — Anzeige nutzt die Session-Daten. MFA- und API-Token-Status sind ggf. nicht aktuell. Seite neu laden.
        </div>
      )}

      {/* Profil-Kopf */}
      <Card className="card-pad" style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 22 }}>{initials(displayName, email)}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{displayName || email || 'Analyst'}</div>
          <div style={{ color: 'var(--accent)', fontSize: 13 }}>{role || '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <MetaCol icon={<Mail size={14} />} label="E-Mail" value={email || '—'} />
          <MetaCol icon={<Calendar size={14} />} label="Mitglied seit" value={profile?.createdAt ? profile.createdAt.slice(0, 10) : '—'} />
          <MetaCol icon={<Clock size={14} />} label="Letzte Anmeldung" value={profile?.lastLoginAt ? profile.lastLoginAt.slice(0, 10) : '—'} />
        </div>
      </Card>

      {/* Reihe 1 — Persönliche Daten + Passwort ändern */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start', marginBottom: 20 }}>
        <PersonalDataSection
          firstName={firstName}
          lastName={lastName}
          email={email}
          phone={phone}
          language={language}
          dateFormat={dateFormat}
          onSaved={setProfile}
        />
        <PasswordSection />
      </div>

      {/* Reihe 2 — Anzeigeeinstellungen */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, alignItems: 'start' }}>
        <Card>
          <CardHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Palette size={15} /> Anzeigeeinstellungen</span>} />
          <CardBody>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Design</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[
                { id: '',      label: 'Dunkel',  icon: <Moon size={14} /> },
                { id: 'light', label: 'Hell',    icon: <Sun size={14} /> },
                { id: 'system', label: 'System', icon: <Monitor size={14} /> },
              ].map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={theme === t.id ? 'primary' : 'ghost'}
                  icon={t.icon}
                  onClick={() => handleThemeChange(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* MFA — Selbstverwaltung (alle Rollen). Bis Flags geladen: Platzhalter. */}
        {features?.mfaEnabled
          ? <MfaSecurityCard />
          : <PlannedCard title="Multi-Faktor-Authentifizierung" hint="MFA (TOTP) ist auf dieser Instanz nicht aktiviert." />}

        {/* Passkeys / WebAuthn — Selbstverwaltung (alle Rollen). Self-gating: rendert nichts, wenn inaktiv. */}
        <WebAuthnCard />

        {/* API-Tokens — Selbstverwaltung (alle Rollen). */}
        {features?.apiTokensEnabled
          ? <ApiTokensCard tokensEnabled />
          : <PlannedCard title="API-Tokens" hint="Persönliche API-Tokens sind auf dieser Instanz nicht aktiviert." />}

        {/* Geräte — geplant */}
        <PlannedCard title="Aktive Geräte & Sessions" hint="Geräte-Logout und Session-Verwaltung folgen in einem späteren Release." />
      </div>
    </div>
  );
}

// ── Persönliche Daten — Speichern real ──────────────────────────────────────

interface PersonalDataProps {
  firstName:  string;
  lastName:   string;
  email:      string;
  phone:      string;
  language:   Language;
  dateFormat: DateFormat;
  onSaved:    (p: UserProfile) => void;
}

function PersonalDataSection({
  firstName, lastName, email, phone, language, dateFormat, onSaved,
}: PersonalDataProps) {
  const [fn,  setFn]  = useState(firstName);
  const [ln,  setLn]  = useState(lastName);
  const [ph,  setPh]  = useState(phone);
  const [lang, setLang]   = useState<Language>(language);
  const [dfmt, setDfmt]   = useState<DateFormat>(dateFormat);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const [done, triggerDone] = useAutoResetFlag(3000);

  // Felder synchronisieren wenn Parent neue Daten liefert
  useEffect(() => { setFn(firstName); }, [firstName]);
  useEffect(() => { setLn(lastName); },  [lastName]);
  useEffect(() => { setPh(phone); },     [phone]);
  useEffect(() => { setLang(language); }, [language]);
  useEffect(() => { setDfmt(dateFormat); }, [dateFormat]);

  async function handleSave() {
    setBusy(true);
    setErr('');
    try {
      const displayName = [fn.trim(), ln.trim()].filter(Boolean).join(' ');
      const updated = await profileApi.updateProfile({
        displayName,
        phone: ph.trim(),
        language: lang,
        dateFormat: dfmt,
      });
      onSaved(updated);
      void changeLanguage(updated.language);
      triggerDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setFn(firstName);
    setLn(lastName);
    setPh(phone);
    setLang(language);
    setDfmt(dateFormat);
    setErr('');
  }

  return (
    <Card>
      <CardHeader title="Persönliche Daten" />
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Vorname"><Input value={fn} onChange={(e) => setFn(e.target.value)} /></Field>
          <Field label="Nachname"><Input value={ln} onChange={(e) => setLn(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="E-Mail"><Input value={email} readOnly /></Field>
          <Field label="Telefon (optional)"><Input value={ph} onChange={(e) => setPh(e.target.value)} placeholder="+49 …" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Sprache">
              <Select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                options={[{ value: 'de', label: 'Deutsch (DE)' }, { value: 'en', label: 'English' }]}
              />
            </Field>
            <Field label="Datumsformat">
              <Select
                value={dfmt}
                onChange={(e) => setDfmt(e.target.value as DateFormat)}
                options={[{ value: 'dmy', label: 'DD.MM.YYYY' }, { value: 'iso', label: 'YYYY-MM-DD' }]}
              />
            </Field>
          </div>
        </div>
        {err  && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
        {done && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success)' }}>Gespeichert ✓</div>}
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={busy} onClick={() => void handleSave()}>
            {busy ? 'Wird gespeichert …' : 'Speichern'}
          </Button>
          <Button variant="ghost" onClick={handleCancel}>Abbrechen</Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Hilfselemente ─────────────────────────────────────────────────────────────

function MetaCol({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>{icon}{label}</div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function PlannedCard({ title, hint }: { title: string; hint: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{hint}</div>
      </CardBody>
    </Card>
  );
}

// ── Passwort ändern — POST /v1/auth/change-password (real, unverändert) ──────

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [done,    triggerDone] = useAutoResetFlag(3000);

  async function submit() {
    const ce = validatePasswordChange(current, next, confirm);
    if (ce) { setError(ce); return; }
    setBusy(true);
    setError('');
    try {
      await authApi.changePassword(current, next);
      triggerDone();
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passwortänderung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Lock size={15} /> Passwort & Sicherheit</span>} />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Aktuelles Passwort"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" /></Field>
          <Field label="Neues Passwort"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" /></Field>
          <Field label="Neues Passwort bestätigen"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" /></Field>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '10px 0 6px' }}>Empfohlen:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {PASSWORD_REQS.map((r) => <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}><Check size={13} style={{ color: 'var(--text-dim)' }} />{r}</div>)}
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        {done  && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success)' }}>Passwort geändert ✓</div>}
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Wird geändert …' : 'Passwort ändern'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
