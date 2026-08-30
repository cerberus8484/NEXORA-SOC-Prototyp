import { useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Input, Field } from '../../components/ui';
import { authApi } from './authApi';
import { validatePasswordChange } from './passwordChangeModel';
import { useTranslation } from 'react-i18next';

/**
 * Erzwungener Passwortwechsel — Voll-Screen-Gate. Greift bei Passwort-Ablauf
 * (Policy, user.passwordExpired) ODER bei der Erstanmeldung mit temporärem
 * Passwort (user.mustChangePassword → firstLogin). Kann nicht übersprungen
 * werden; nach Erfolg lädt onDone() den Benutzer neu → Gate verschwindet.
 */
export function ForcedPasswordChange({
  email,
  firstLogin = false,
  onDone,
  onLogout,
}: {
  email: string;
  firstLogin?: boolean;
  onDone: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}) {
  const { t: tr } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  // Die Fehlermeldung gehoert zum ABGESCHICKTEN Stand, nicht zum aktuellen.
  // Bleibt sie beim Tippen stehen, korrigiert der Nutzer das Feld und sieht
  // weiterhin "stimmen nicht ueberein" -- es sieht aus, als ginge es gar nicht.
  const edit = (set: (v: string) => void) => (v: string) => { set(v); setError(''); };

  async function submit() {
    const ve = validatePasswordChange(current, next, confirm);
    if (ve) { setError(ve); return; }
    setBusy(true);
    setError('');
    try {
      await authApi.changePassword(current, next);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('app.passwordChangeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <Card>
          <CardHeader
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} /> {firstLogin ? tr('auth.firstLoginTitle') : tr('auth.passwordExpiredTitle')}
              </span>
            }
          />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {firstLogin
                  ? tr('auth.firstLoginIntro', { email })
                  : tr('auth.passwordExpiredIntro', { email })}
              </div>
              <Field label={tr('settings.currentPassword')}>
                <Input type="password" name="current-password" autoComplete="current-password"
                       value={current} onChange={(e) => edit(setCurrent)(e.target.value)} placeholder="••••••••" />
              </Field>
              <Field label={tr('label.newPassword')}>
                <Input type="password" name="new-password" autoComplete="new-password"
                       value={next} onChange={(e) => edit(setNext)(e.target.value)} placeholder="••••••••" />
              </Field>
              <Field label={tr('app.confirmNewPassword')}>
                <Input type="password" name="confirm-password" autoComplete="new-password"
                       value={confirm} onChange={(e) => edit(setConfirm)(e.target.value)} placeholder="••••••••" />
              </Field>
              {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
              <Button variant="primary" disabled={busy} onClick={() => void submit()}>
                {busy ? tr('app.changing') : tr('app.changePasswordContinue')}
              </Button>
              <Button variant="ghost" size="sm" icon={<LogOut size={14} />} onClick={() => void onLogout()}>{tr('nav.signOut')}</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
