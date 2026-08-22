import { useState, useEffect, type CSSProperties } from 'react';
import { KeyRound, Check, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Field, Input, Select, Spinner, Toggle } from '../../components/ui';
import {
  getOidcConfig, saveOidcConfig, testOidcConnection,
  type OidcAdminConfig, type OidcConfigPatch, type OidcDefaultRole, type OidcTestResult,
} from './oidcAdminApi';
import { ArmPasswordDialog } from '../services/ArmPasswordDialog';
import { ApiError } from '../../lib/apiClient';

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'engineer', label: 'Engineer' },
];

const s: Record<string, CSSProperties> = {
  hint: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' },
  note: { display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, padding: '8px 10px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' },
  danger: { fontSize: 12, color: 'var(--danger)' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
};

/**
 * OIDC / SSO — In-UI-Admin-Konfiguration (P1 #6). Admin-only schreibend.
 * Issuer/Client/Secret/Scope/Rolle/Signup + Aktivierung via UI statt ENV.
 * Das Client-Secret ist write-only (kommt nie aus dem GET zurück).
 */
export function OidcSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const [cfg, setCfg] = useState<OidcAdminConfig | null>(null);
  const [secret, setSecret] = useState(''); // write-only; '' = unverändert
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [test, setTest] = useState<OidcTestResult | 'testing' | null>(null);
  const [armOpen, setArmOpen] = useState(false);   // Step-up-Passwort-Dialog
  const [armError, setArmError] = useState('');

  useEffect(() => {
    let alive = true;
    getOidcConfig()
      .then((c) => { if (alive) setCfg(c); })
      .catch(() => { if (alive) setErrMsg('OIDC-Konfiguration konnte nicht geladen werden.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <Card><CardBody><Spinner /></CardBody></Card>;
  if (!cfg) return <Card><CardBody><div style={s.danger}>{errMsg}</div></CardBody></Card>;

  const patch = (p: Partial<OidcAdminConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  // Aktivieren nur erlauben, wenn die Config danach vollständig wäre (mirror Server-Guard).
  const hasSecret = cfg.clientSecretSet || secret.trim() !== '';
  const canEnable = Boolean(cfg.issuer.trim() && cfg.clientId.trim() && hasSecret);

  const runTest = async () => {
    setTest('testing');
    try { setTest(await testOidcConnection(cfg.issuer)); }
    catch (e) { setTest({ ok: false, error: e instanceof Error ? e.message : 'Fehler' }); }
  };

  // OIDC steuert die Plattform-Auth → Speichern erfordert eine Step-up-Passwortbestätigung.
  const openSave = () => { setErrMsg(''); setArmError(''); setArmOpen(true); };

  const doSave = async (password: string) => {
    setSaveState('saving');
    setArmError('');
    const body: OidcConfigPatch = {
      enabled: cfg.enabled, issuer: cfg.issuer.trim(), clientId: cfg.clientId.trim(),
      redirectUri: cfg.redirectUri.trim(), scope: cfg.scope.trim(),
      defaultRole: cfg.defaultRole, allowSignup: cfg.allowSignup,
    };
    if (secret.trim() !== '') body.clientSecret = secret.trim();
    try {
      const saved = await saveOidcConfig(body, password);
      setCfg(saved);
      setSecret('');
      setArmOpen(false);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error');
      // Falsches Step-up-Passwort → Dialog offen lassen, Fehler dort zeigen (Retry).
      if (e instanceof ApiError && e.status === 403) { setArmError('Passwort ungültig.'); return; }
      setArmOpen(false);
      const msg = e instanceof Error ? e.message : '';
      setErrMsg(/incomplete/i.test(msg)
        ? 'SSO kann nur aktiviert werden, wenn Issuer, Client-ID und Client-Secret gesetzt sind.'
        : 'Speichern fehlgeschlagen (nur Admin, gültige https-URLs).');
    }
  };

  return (
    <Card>
      <CardHeader
        title="SSO / OpenID Connect"
        actions={
          cfg.configured
            ? <Badge tone={cfg.enabled ? 'success' : 'muted'} dot>{cfg.enabled ? 'Aktiv' : 'Konfiguriert'}</Badge>
            : <Badge tone="warning" dot>Nicht konfiguriert</Badge>
        }
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={s.note}>
            <ShieldCheck size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
            <span>
              Authorization Code + PKCE. Das <strong>Client-Secret</strong> wird verschlüsselt gespeichert und
              nie wieder angezeigt — leer lassen, um es unverändert zu behalten. Account-Linking nur bei
              verifizierter E-Mail; neue SSO-Nutzer erhalten die Standardrolle (kein Auto-Admin).
            </span>
          </div>

          <Field label="Issuer (https)">
            <Input value={cfg.issuer} disabled={!isAdmin} placeholder="https://idp.example.com/realms/soc"
              onChange={(e) => patch({ issuer: e.target.value })} />
          </Field>

          <div style={s.grid2}>
            <Field label="Client-ID">
              <Input value={cfg.clientId} disabled={!isAdmin} placeholder="nexora-soc"
                onChange={(e) => patch({ clientId: e.target.value })} />
            </Field>
            <Field label="Client-Secret">
              <Input type="password" value={secret} disabled={!isAdmin}
                placeholder={cfg.clientSecretSet ? '•••••••••• (gesetzt — leer = behalten)' : 'Client-Secret eingeben'}
                onChange={(e) => setSecret(e.target.value)} />
            </Field>
          </div>

          <Field label="Redirect-URI (am IdP registriert)">
            <Input value={cfg.redirectUri} disabled={!isAdmin} placeholder="https://nexora.example/api/v1/auth/oidc/callback"
              onChange={(e) => patch({ redirectUri: e.target.value })} />
          </Field>

          <div style={s.grid2}>
            <Field label="Scope">
              <Input value={cfg.scope} disabled={!isAdmin} placeholder="openid profile email"
                onChange={(e) => patch({ scope: e.target.value })} />
            </Field>
            <Field label="Standardrolle (Auto-Signup)">
              <Select value={cfg.defaultRole} disabled={!isAdmin} options={ROLE_OPTIONS}
                onChange={(e) => patch({ defaultRole: e.target.value as OidcDefaultRole })} />
            </Field>
          </div>

          <Toggle label="Auto-Signup neuer Nutzer (nur bei verifizierter E-Mail)"
            checked={cfg.allowSignup} disabled={!isAdmin}
            onChange={(v) => patch({ allowSignup: v })} />
          <Toggle label="SSO aktiv (Login-Button anzeigen)"
            checked={cfg.enabled} disabled={!isAdmin || (!cfg.enabled && !canEnable)}
            onChange={(v) => patch({ enabled: v })} />
          {!cfg.enabled && !canEnable && (
            <div style={s.hint}><AlertTriangle size={12} /> Aktivierung erst möglich, wenn Issuer, Client-ID und Secret gesetzt sind.</div>
          )}

          {errMsg && <div style={s.danger}>{errMsg}</div>}

          {isAdmin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Button variant={saveState === 'saved' ? 'success' : 'primary'} size="sm"
                onClick={openSave} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Wird gespeichert …' : saveState === 'saved' ? '✓ Gespeichert' : 'OIDC speichern'}
              </Button>
              <Button variant="ghost" size="sm" onClick={runTest}
                disabled={test === 'testing' || !cfg.issuer.trim()}>
                {test === 'testing' ? 'Teste …' : 'Verbindung testen'}
              </Button>
              {test && test !== 'testing' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: test.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {test.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
                  {test.ok ? `Discovery ok${test.latencyMs != null ? ` (${test.latencyMs} ms)` : ''}` : (test.error || 'Fehlgeschlagen')}
                </span>
              )}
              <span style={s.hint}><KeyRound size={12} /> Schreibrechte nur für Admin</span>
            </div>
          )}
        </div>
      </CardBody>
      <ArmPasswordDialog
        open={armOpen}
        busy={saveState === 'saving'}
        error={armError}
        title="OIDC-Konfiguration ändern"
        description="OIDC/SSO steuert die Anmeldung der ganzen Plattform. Zum Speichern dein Passwort bestätigen — die Änderung wird protokolliert."
        confirmLabel="Speichern"
        onConfirm={(pw) => void doSave(pw)}
        onCancel={() => { setArmOpen(false); setArmError(''); }}
      />
    </Card>
  );
}
