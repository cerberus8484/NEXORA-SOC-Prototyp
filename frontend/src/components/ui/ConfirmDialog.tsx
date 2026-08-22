import { useId, useRef, type CSSProperties } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';
import { useFocusTrap, useReturnFocus } from '../../hooks/useFocusTrap';

// Wiederverwendbarer Bestätigungs-Dialog — ersetzt window.confirm() durch ein
// konsistentes, barrierearmes Modal (role=alertdialog, Fokus-Trap, ESC, Fokus-Rückgabe).
// Rein präsentational; den imperativen „erst fragen, dann handeln"-Fluss kapselt useConfirm.

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  zIndex: 2200, display: 'grid', placeItems: 'center', padding: 20,
};
const PANEL: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)',
  width: 'min(440px, 96vw)', display: 'flex', flexDirection: 'column', padding: 20, gap: 14,
};

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();   // eindeutige ARIA-IDs (mehrere Dialoge im DOM kollisionsfrei)
  const messageId = useId();
  useFocusTrap(panelRef, open, onCancel); // Tab-Trap + ESC → onCancel
  useReturnFocus(open);                   // Fokus zurück zum Auslöser beim Schließen

  if (!open) return null;

  return (
    // stopPropagation: ConfirmDialog kann INNERHALB eines anderen Modals stehen — ein
    // Klick auf den Confirm-Backdrop darf nicht das Eltern-Modal (overlay onClick) schließen.
    // a11y: Tastaturpfad ist ESC (useFocusTrap); der Backdrop-Klick ist reine Maus-Ergänzung
    // und darf laut WAI-ARIA-APG kein fokussierbarer Button sein.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      style={OVERLAY}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* onClick dient nur der Event-Eindämmung (stopPropagation), ist keine Aktion → kein Keyboard-Handler nötig */}
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
          {danger && <AlertTriangle size={17} style={{ color: 'var(--danger)' }} />}
          <strong id={titleId} style={{ fontSize: 14 }}>{title}</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onCancel} aria-label="Schließen" style={{ marginLeft: 'auto' }} />
        </div>

        <p id={messageId} style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          {message}
        </p>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          {/* autoFocus: Modal mountet bei jedem Öffnen neu → Fokus landet auf der Aktion */}
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? '…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
