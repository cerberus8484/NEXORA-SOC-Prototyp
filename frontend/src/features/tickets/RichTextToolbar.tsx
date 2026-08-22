import type { RefObject } from 'react';
import {
  Undo2, Redo2, Bold, Italic, Underline, List, ListOrdered, Link2, Code2,
} from 'lucide-react';

interface Props {
  targetRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Leichte Markdown-Toolbar für das Beschreibungsfeld.
 * Fügt echte Marker um die Auswahl ein (kein WYSIWYG, kein Fake).
 * Undo/Redo bleiben deaktiviert — dafür nativ Strg+Z / Strg+Y nutzen.
 */
export function RichTextToolbar({ targetRef, value, onChange, disabled }: Props) {
  function surround(before: string, after = before) {
    const ta = targetRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.slice(s, e) || 'Text';
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
    });
  }

  function linePrefix(prefix: string) {
    const ta = targetRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e);
    const prefixed = block.split('\n').map((l) => prefix + l).join('\n');
    const next = value.slice(0, lineStart) + prefixed + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => ta.focus());
  }

  const Btn = ({ title, onClick, children, off }: { title: string; onClick?: () => void; children: React.ReactNode; off?: boolean }) => (
    <button
      type="button"
      className="rtb-btn"
      title={title}
      aria-label={title}
      disabled={disabled || off}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="rtb">
      <Btn title="Rückgängig (Strg+Z)" off><Undo2 size={15} /></Btn>
      <Btn title="Wiederherstellen (Strg+Y)" off><Redo2 size={15} /></Btn>
      <span className="rtb-sep" />
      <Btn title="Fett" onClick={() => surround('**')}><Bold size={15} /></Btn>
      <Btn title="Kursiv" onClick={() => surround('*')}><Italic size={15} /></Btn>
      <Btn title="Unterstrichen" onClick={() => surround('<u>', '</u>')}><Underline size={15} /></Btn>
      <span className="rtb-sep" />
      <Btn title="Aufzählung" onClick={() => linePrefix('- ')}><List size={15} /></Btn>
      <Btn title="Nummerierte Liste" onClick={() => linePrefix('1. ')}><ListOrdered size={15} /></Btn>
      <span className="rtb-sep" />
      <Btn title="Link einfügen" onClick={() => surround('[', '](https://)')}><Link2 size={15} /></Btn>
      <Btn title="Code" onClick={() => surround('`')}><Code2 size={15} /></Btn>
    </div>
  );
}
