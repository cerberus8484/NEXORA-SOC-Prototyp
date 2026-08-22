import { useState, useEffect, type FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, KeyRound, LogIn, Fingerprint } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { authApi } from '../features/auth/authApi';
import { BrandMark } from '../layout/BrandMark';
import { APP_NAME } from '../app/appMeta';
import { Button, Field, Input } from '../components/ui';
import { validateMfaCode } from '../features/auth/loginChallengeModel';
import { hasSsoError, OIDC_LOGIN_URL } from '../features/auth/oidcLogin';
import { getWebauthnStatus, loginWithPasskey, isPasskeySupported } from '../features/auth/webauthnLogin';
import { useTranslation } from 'react-i18next';

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, completeMfaChallenge, completeMfaSetup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // MFA-Challenge-Schritt (User hat bereits aktive MFA).
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // Erzwungener MFA-Setup-Schritt (org-weite Pflicht, User hat noch keine MFA).
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState('');
  const [setupOtpauthUri, setSetupOtpauthUri] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // SSO/OIDC + Passkey: Buttons nur zeigen, wenn serverseitig aktiv (öffentliche Status-Endpunkte).
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const location = useLocation();
  const ssoError = hasSsoError(location.search);

  useEffect(() => {
    const controller = new AbortController();
    authApi.getOidcStatus(controller.signal)
      .then((s) => setSsoEnabled(s.enabled))
      .catch(() => { /* Status nicht ermittelbar → SSO-Button bleibt aus */ });
    getWebauthnStatus(controller.signal)
      .then((s) => setPasskeyEnabled(s.enabled))
      .catch(() => { /* Status nicht ermittelbar → Passkey-Button bleibt aus */ });
    return () => controller.abort();
  }, []);

  // Passkey-Login: Ceremony im Browser → Session-Cookie wird serverseitig gesetzt;
  // danach volle Navigation, damit der Auth-Context die neue Sitzung übernimmt.
  async function handlePasskeyLogin() {
    setError('');
    setBusy(true);
    try {
      await loginWithPasskey();
      window.location.assign('/dashboard');
    } catch {
      setError(t('auth.passkeyFailed'));
      setBusy(false);
    }
  }

  // Solange Recovery-Codes angezeigt werden, NICHT automatisch weiterleiten —
  // der User muss sie zuerst sehen (User ist nach completeMfaSetup bereits gesetzt).
  if (user && !recoveryCodes) return <Navigate to="/dashboard" replace />;

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken); // 2. Faktor
        return;
      }
      if (result.mfaSetupRequired) {
        // Org-weite Pflicht: Enrollment direkt starten (Secret/QR holen).
        const begin = await authApi.beginMfaSetup(result.setupToken);
        setSetupToken(result.setupToken);
        setSetupSecret(begin.secret);
        setSetupOtpauthUri(begin.otpauthUri);
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    const ve = validateMfaCode(code);
    if (ve) { setError(ve); return; }
    setError('');
    setBusy(true);
    try {
      await completeMfaChallenge(challengeToken, code);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.verificationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitSetup(e: FormEvent) {
    e.preventDefault();
    if (!setupToken) return;
    const ve = validateMfaCode(setupCode);
    if (ve) { setError(ve); return; }
    setError('');
    setBusy(true);
    try {
      const codes = await completeMfaSetup(setupToken, setupCode);
      setRecoveryCodes(codes); // → Recovery-Schritt; Login ist serverseitig bereits etabliert
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.mfaSetupFailed'));
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setChallengeToken(null);
    setSetupToken(null);
    setSetupSecret('');
    setSetupOtpauthUri('');
    setSetupCode('');
    setCode('');
    setError('');
  }

  const step: 'password' | 'mfa' | 'setup' | 'recovery' =
    recoveryCodes ? 'recovery' : setupToken ? 'setup' : challengeToken ? 'mfa' : 'password';

  const onSubmit =
    step === 'mfa' ? onSubmitMfa : step === 'setup' ? onSubmitSetup : onSubmitPassword;

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'radial-gradient(circle at 50% 28%, var(--bg-elevated), var(--bg))' }}>
      <form className="card card-pad" style={{ width: 372, padding: 32 }} onSubmit={onSubmit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <BrandMark size={32} />
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: 1 }}>{APP_NAME}</span>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 24px' }}>Enterprise Incident &amp; Threat Hunting</p>

        {step === 'mfa' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
              <ShieldCheck size={16} />
              <span>{t('auth.mfaRequired')}</span>
            </div>
            <Field label={t('auth.verificationCode')} hint={t('auth.mfaCodeHint')}>
              <Input type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="123456" autoFocus required mono />
            </Field>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('auth.verifying') : t('auth.verify')}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={backToPassword} disabled={busy}>{t('common.back')}</Button>
          </div>
        )}

        {step === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
              <ShieldCheck size={16} />
              <span>{t('auth.mfaRequiredSetup')}</span>
            </div>
            <Field label={t('auth.authenticatorSecret')} hint={t('auth.authenticatorHint')}>
              <Input type="text" value={setupSecret} readOnly mono onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>{setupOtpauthUri}</div>
            <Field label={t('auth.verificationCode')} hint={t('auth.setupCodeHint')}>
              <Input type="text" inputMode="numeric" autoComplete="one-time-code" value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)} placeholder="123456" autoFocus required mono />
            </Field>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('auth.activating') : t('auth.activateMfa')}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={backToPassword} disabled={busy}>{t('common.cancel')}</Button>
          </div>
        )}

        {step === 'recovery' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontSize: 13 }}>
              <KeyRound size={16} />
              <span>{t('auth.mfaEnabled')}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('auth.recoveryNotice')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
              {(recoveryCodes ?? []).map((rc) => <span key={rc}>{rc}</span>)}
            </div>
            <Button type="button" variant="primary" onClick={() => navigate('/dashboard', { replace: true })}>
              {t('auth.continueToDashboard')}
            </Button>
          </div>
        )}

        {step === 'password' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label={t('auth.email')}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
            </Field>
            <Field label={t('auth.password')}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            {ssoError && !error && (
              <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
                {t('auth.ssoFailed')}
              </div>
            )}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('auth.signingIn') : t('auth.signIn')}</Button>

            {(ssoEnabled || (passkeyEnabled && isPasskeySupported())) && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-dim)', fontSize: 12 }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                  {t('auth.or')}
                  <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                </div>
                {ssoEnabled && (
                  <Button type="button" variant="ghost" disabled={busy}
                    onClick={() => { window.location.href = OIDC_LOGIN_URL; }}>
                    <LogIn size={16} style={{ marginRight: 8 }} /> {t('auth.signInWithSso')}
                  </Button>
                )}
                {passkeyEnabled && isPasskeySupported() && (
                  <Button type="button" variant="ghost" disabled={busy} onClick={handlePasskeyLogin}>
                    <Fingerprint size={16} style={{ marginRight: 8 }} /> {t('auth.signInWithPasskey')}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
