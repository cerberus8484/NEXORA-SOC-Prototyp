import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { parseChecklist, serializeChecklist, type ChecklistItem as Item } from '../../lib/checklist';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export function ChecklistField({ value, onChange, readOnly, placeholder }: Props) {
  const { t: tr } = useTranslation();
  const items = parseChecklist(value);
  const [draft, setDraft] = useState('');

  const update = (next: Item[]) => onChange(serializeChecklist(next));
  const toggle = (i: number) => update(items.map((it, idx) => (idx === i ? { ...it, checked: !it.checked } : it)));
  const setText = (i: number, text: string) => update(items.map((it, idx) => (idx === i ? { ...it, text } : it)));
  const remove = (i: number) => update(items.filter((_, idx) => idx !== i));
  const add = () => {
    if (!draft.trim()) return;
    update([...items, { checked: false, text: draft.trim() }]);
    setDraft('');
  };

  return (
    <div className="checklist">
      {items.map((it, i) => (
        // Editierbare Liste ohne stabile ID: toggle/setText/remove adressieren per Index,
        // und leere/neue Zeilen haben keinen eindeutigen Text → Index ist hier der korrekte Key.
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className={`checklist-row ${it.checked ? 'checked' : ''}`}>
          <input type="checkbox" className="checklist-cb" checked={it.checked} onChange={() => toggle(i)} disabled={readOnly} />
          <input type="text" value={it.text} onChange={(e) => setText(i, e.target.value)} readOnly={readOnly} />
          {!readOnly && <button type="button" className="checklist-del" onClick={() => remove(i)} title={tr('common.remove')}><X size={14} /></button>}
        </div>
      ))}
      {!readOnly && (
        <div className="checklist-row">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={placeholder ?? tr('ui.addEntry')}
            style={{ color: 'var(--text-muted)' }}
          />
          <button type="button" className="checklist-add" onClick={add}><Plus size={14} /></button>
        </div>
      )}
    </div>
  );
}
