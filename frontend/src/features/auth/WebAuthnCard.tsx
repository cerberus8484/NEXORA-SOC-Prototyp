import { useEffect, useState } from 'react';
import { Fingerprint, Trash2, Plus } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import {
  getWebauthnStatus, listPasskeys, registerPasskey, deletePasskey, isPasskeySupported,
  type WebauthnCredential,
} from './webauthnLogin';

/**
 * Passkey-Selbstverwaltung (Profil). Self-contained: holt den Status selbst und
 * rendert nichts, wenn WebAuthn serverseitig inaktiv ist — kein Backend-Touch nötig.
 */
export function WebAuthnCard() {
  const { t: tr } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [creds, setCreds] = useState<WebauthnCredential[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = new AbortController();
    getWebauthnStatus(c.signal).then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    listPasskeys(c.signal).then(setCreds).catch(() => { /* leer lassen */ });
    return () => c.abort();
  }, [enabled]);

  if (!enabled) return null; // Status lädt (null) oder Feature aus → keine Card

  async function handleAdd() {
    setError('');
    setBusy(true);
    try {
      const cred = await registerPasskey();
      setCreds((cur) => [...cur, cred]);
    } catch {
      setError(tr('app.passkeyCouldNotRegisteredCeremony'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    try {
      await deletePasskey(id);
      setCreds((cur) => cur.filter((c) => c.id !== id));
    } catch {
      setError(tr('app.passkeyCouldNotRemoved'));
    }
  }

  return (
    <Card className="card-pad" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Fingerprint size={18} />
        <strong>{tr('app.passkeysSecurityKeys')}</strong>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>{tr('mfa.passkeyIntro')}</p>

      {creds.length === 0 ? (
        <p style={{ fontSize: 13 }}>{tr('app.noPasskeyRegisteredYet')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
          {creds.map((c) => (
            <li
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}
            >
              <span style={{ fontSize: 13 }}>
                {c.label || 'Passkey'} · {c.transports.join(', ') || 'unbekannt'}
                {c.lastUsedAt && (
                  <span style={{ color: 'var(--text-dim)' }}> · zuletzt {new Date(c.lastUsedAt).toLocaleString()}</span>
                )}
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => handleDelete(c.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      {isPasskeySupported() ? (
        <Button type="button" variant="primary" size="sm" disabled={busy} onClick={handleAdd}>
          <Plus size={14} style={{ marginRight: 6 }} />{tr('mfa.addPasskey')}</Button>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{tr('app.browserDoesNotSupportPasskeys')}</p>
      )}
    </Card>
  );
}
