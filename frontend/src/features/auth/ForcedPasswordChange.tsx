import { useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Input, Field } from '../../components/ui';
import { authApi } from './authApi';
import { validatePasswordChange } from './passwordChangeModel';

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
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    const ve = validatePasswordChange(current, next, confirm);
    if (ve) { setError(ve); return; }
    setBusy(true);
    setError('');
    try {
      await authApi.changePassword(current, next);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passwortänderung fehlgeschlagen');
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
                <Lock size={15} /> {firstLogin ? 'Erstanmeldung — Passwort festlegen' : 'Passwort abgelaufen'}
              </span>
            }
          />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {firstLogin
                  ? `Willkommen. Dieses Konto wurde mit einem temporären Passwort eingerichtet. Bitte vergib jetzt ein eigenes, sicheres Passwort, um fortzufahren (${email}).`
                  : `Dein Passwort ist gemäß Sicherheitsrichtlinie abgelaufen. Bitte vergib ein neues Passwort, um fortzufahren (${email}).`}
              </div>
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
              <Button variant="primary" disabled={busy} onClick={() => void submit()}>
                {busy ? 'Wird geändert …' : 'Passwort ändern & fortfahren'}
              </Button>
              <Button variant="ghost" size="sm" icon={<LogOut size={14} />} onClick={() => void onLogout()}>
                Abmelden
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
