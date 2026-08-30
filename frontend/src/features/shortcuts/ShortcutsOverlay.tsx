import { useRef, type CSSProperties } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from '../../components/ui';
import { useFocusTrap, useReturnFocus } from '../../hooks/useFocusTrap';
import { NAV_SHORTCUTS, ACTION_SHORTCUTS, LEADER_KEY } from './shortcutModel';
import { useTranslation } from 'react-i18next';

// Hilfe-Overlay (Taste `?`) — listet alle Shortcuts direkt aus der Registry,
// damit Anzeige und Verhalten nicht auseinanderlaufen. Barrierearm: role=dialog,
// Fokus-Trap + ESC (useFocusTrap), Fokus-Rückgabe beim Schließen.

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  zIndex: 2300, display: 'grid', placeItems: 'center', padding: 20,
};
const PANEL: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)',
  width: 'min(560px, 96vw)', maxHeight: '85vh', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', padding: 20, gap: 14,
};
const KBD: CSSProperties = {
  display: 'inline-grid', placeItems: 'center', minWidth: 20, height: 20, padding: '0 6px',
  background: 'var(--bg-input)', border: '1px solid var(--border-soft)',
  borderRadius: 'var(--radius-sm)', fontSize: 11, fontFamily: 'var(--font-mono)',
  color: 'var(--text)', lineHeight: 1,
};
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, padding: '5px 0', borderBottom: '1px solid var(--border-soft)',
};
const SECTION_LABEL: CSSProperties = {
  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'var(--text-dim)', marginTop: 6, marginBottom: 2,
};

function Kbd({ children }: { children: React.ReactNode }) {
  return <span style={KBD}>{children}</span>;
}

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  const { t: tr } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, onClose);
  useReturnFocus(open);

  if (!open) return null;

  return (
    // a11y: ESC schließt (useFocusTrap); Backdrop-Klick ist reine Maus-Ergänzung
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} style={PANEL} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Keyboard size={17} style={{ color: 'var(--accent)' }} />
          <strong id="shortcuts-title" style={{ fontSize: 14 }}>Tastatur-Shortcuts</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} aria-label={tr('common.close')} style={{ marginLeft: 'auto' }} />
        </div>

        <div style={SECTION_LABEL}>Navigation — <Kbd>{LEADER_KEY}</Kbd> {tr('text.then')}</div>
        <div>
          {NAV_SHORTCUTS.map((s) => (
            <div key={s.key} style={ROW}>
              <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{s.label}</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <Kbd>{LEADER_KEY}</Kbd>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{tr('text.then2')}</span>
                <Kbd>{s.key}</Kbd>
              </span>
            </div>
          ))}
        </div>

        <div style={SECTION_LABEL}>Aktionen</div>
        <div>
          {ACTION_SHORTCUTS.map((s) => (
            <div key={s.key} style={{ ...ROW, ...(s.id === 'help' ? { borderBottom: 'none' } : {}) }}>
              <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{s.label}</span>
              <Kbd>{s.key}</Kbd>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{tr('shortcuts.notWhileTyping')}<Kbd>Esc</Kbd>{tr('shortcuts.closesThisWindow')}</div>
      </div>
    </div>
  );
}
