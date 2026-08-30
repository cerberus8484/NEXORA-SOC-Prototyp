import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { X, Copy, FileCode2, Check, Download } from 'lucide-react';
import { Button } from '../../components/ui';
import { useTranslation } from 'react-i18next';

// Anzeige des generierten Incident-Reports (Box-Drawing-Template) mit Copy-to-Clipboard.
// Gleiches Overlay-Muster wie WazuhExceptionBuilderModal.

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(880px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 20 };
const TEXT: CSSProperties = {
  flex: 1, minHeight: 380, width: '100%', resize: 'none',
  background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', padding: 12, fontSize: 12, lineHeight: 1.45, fontFamily: 'var(--font-mono)',
  whiteSpace: 'pre', overflow: 'auto',
};

interface TemplateModalProps {
  text: string;
  onClose: () => void;
}

export function TemplateModal({ text, onClose }: TemplateModalProps) {
  const { t: tr } = useTranslation();
  const [copied, setCopied] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      closeTimerRef.current = setTimeout(onClose, 600);
    } catch {
      // Clipboard-API nicht verfügbar (z.B. unsicherer Kontext) — Text bleibt
      // markierbar, der Analyst kopiert manuell.
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incident-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    // a11y: Backdrop-Klick = reine Maus-Ergänzung; Tastaturpfad ist der fokussierbare X-Schließen-Button im Dialog
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <FileCode2 size={17} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14 }}>Incident-Report-Template</strong>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={download}>Download</Button>
            <Button size="sm" variant="primary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>
              {copied ? tr('common.copiedCheck') : tr('common.copy')}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} />
          </span>
        </div>
        <textarea style={TEXT} value={text} readOnly spellCheck={false} />
      </div>
    </div>
  );
}
