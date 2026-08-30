import { useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { Button, Field, Input } from '../../components/ui';
import { useFocusTrap, useReturnFocus } from '../../hooks/useFocusTrap';
import { useTranslation } from 'react-i18next';

// Passwort-Bestätigungs-Dialog fürs Scharfschalten des Manager-Restarts.
// Analog zu ConfirmDialog (role=alertdialog, Fokus-Trap, ESC, Fokus-Rückgabe),
// aber mit einem Passwort-Feld: der Server verifiziert das Passwort des aktuellen
// Users. Das Passwort verlässt die Komponente nur beim Bestätigen und wird nach
// Schließen nicht gehalten.

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  zIndex: 2200, display: 'grid', placeItems: 'center', padding: 20,
};
const PANEL: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)',
  width: 'min(440px, 96vw)', display: 'flex', flexDirection: 'column', padding: 20, gap: 14,
};

export interface ArmPasswordDialogProps {
  open: boolean;
  busy?: boolean;
  error?: string;
  /** Dialog-Titel (Default: Scharfschalt-Fluss). */
  title?: string;
  /** Erklärtext über dem Passwort-Feld (Default: Scharfschalt-Fluss). */
  description?: string;
  /** Beschriftung des Bestätigen-Buttons (Default: Scharfschalt-Fluss). */
  confirmLabel?: string;
  /** Erhält das eingegebene Passwort beim Bestätigen. */
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function ArmPasswordDialog({
  open, busy = false, error = '',
  title,
  description,
  confirmLabel,
  onConfirm, onCancel,
}: ArmPasswordDialogProps) {
  const { t: tr } = useTranslation();
  const titleText   = title ?? tr('services.armRestart');
  const descText    = description ?? (tr('ui.confirmYourPasswordArmAfter') + ' '
                                      + tr('ui.wazuhManagerCanRestartedFrom'));
  const confirmText = confirmLabel ?? tr('services.arm');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [password, setPassword] = useState('');

  useFocusTrap(panelRef, open, onCancel);
  useReturnFocus(open);

  if (!open) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || password === '') return;
    onConfirm(password);
  }

  function handleCancel() {
    setPassword(''); // Passwort nicht über das Schließen hinaus halten.
    onCancel();
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      style={OVERLAY}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) handleCancel(); }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        ref={panelRef}
        style={PANEL}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
          <strong id={titleId} style={{ fontSize: 14 }}>{titleText}</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={handleCancel} aria-label={tr('common.close')} style={{ marginLeft: 'auto' }} />
        </div>

        <p id={messageId} style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          {descText}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label={tr('common.password')}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              // Modal mountet bei jedem Öffnen neu → Fokus landet im Feld.
              autoFocus
            />
          </Field>

          {error && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={busy}>{tr('common.cancel2')}</Button>
            <Button type="submit" variant="primary" disabled={busy || password === ''}>
              {busy ? '…' : confirmText}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
