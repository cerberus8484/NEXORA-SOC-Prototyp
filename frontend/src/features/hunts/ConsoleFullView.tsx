import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import type { HuntLog } from '../../lib/types';
import { toConsoleLines, toPlainText } from './consoleOutput';
import { Button } from '../../components/ui';

const LOG_COLOR: Record<string, string> = {
  info: 'var(--text-muted, #8b95a7)', warning: 'var(--warning, #f5a623)',
  error: 'var(--danger, #ff5470)', success: 'var(--success, #00ff88)',
};

const s: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal:    { width: 'min(1000px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', overflow: 'hidden' },
  head:     { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' },
  body:     { flex: 1, overflow: 'auto', background: 'var(--bg-terminal, #0a0e17)', padding: '14px 0', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.7 },
  line:     { display: 'grid', gridTemplateColumns: '56px 1fr', whiteSpace: 'pre-wrap', paddingRight: 18 },
  num:      { color: 'var(--text-dim)', textAlign: 'right', paddingRight: 14, userSelect: 'none', borderRight: '1px solid var(--border-soft)', marginRight: 14 },
};

interface Props {
  title: string;
  logs: ReadonlyArray<HuntLog>;
  onClose: () => void;
  onExport?: () => void;
}

// Vollansicht des Session-Outputs: alle Zeilen, scrollbar, mit Zeilennummern.
export function ConsoleFullView({ title, logs, onClose, onExport }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = toConsoleLines(logs);

  return createPortal(
    // a11y: ESC schließt (onKey-Handler oben); Backdrop-Klick ist reine Maus-Ergänzung
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div style={s.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Console Vollansicht">
      {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Console — {title} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {lines.length} Zeilen</span>
          </span>
          {onExport && <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={onExport}>Export</Button>}
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label="Schließen">Schließen</Button>
        </div>
        <div style={s.body}>
          {lines.length === 0
            ? <div style={{ padding: '0 18px', color: 'var(--text-dim)' }}>Noch keine Logs.</div>
            : lines.map((l, i) => (
              <div key={l.id} style={s.line}>
                <span style={s.num}>{i + 1}</span>
                <span style={{ color: LOG_COLOR[l.level] }}>{l.text}</span>
              </div>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Re-export für Tests/Consumer, die den reinen Text brauchen.
export { toPlainText };
