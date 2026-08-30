import { Trash2 } from 'lucide-react';
import { Field, Input, Select, Button } from '../../components/ui';
import { TI_CATEGORY_OPTS, TI_CONFIDENCE_OPTS, type TiEntry } from './tiEntry';
import { useTranslation } from 'react-i18next';

// Wiederholbarer Editor für Threat-Intel-Einträge (mehrere pro Ticket).
// Reines Presentational-Component — Zustand hält der TicketEditor.

interface TiEntryEditorProps {
  value: TiEntry[];
  onChange: (entries: TiEntry[]) => void;
  readOnly?: boolean;
}

export function TiEntryEditor({ value, onChange, readOnly = false }: TiEntryEditorProps) {
  const { t: tr } = useTranslation();
  function patch(id: string, field: keyof TiEntry, fieldValue: string) {
    onChange(value.map((e) => (e.id === id ? { ...e, [field]: fieldValue } : e)));
  }

  function remove(id: string) {
    onChange(value.filter((e) => e.id !== id));
  }

  if (value.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '6px 2px' }}>{tr('tickets.noTiEntry')}</div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {value.map((e, i) => (
        <div
          key={e.id}
          style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12, position: 'relative' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5 }}>
              TI-EINTRAG {String(i + 1).padStart(2, '0')}
            </span>
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={() => remove(e.id)}
                title={tr('common.removeEntry')}
                style={{ marginLeft: 'auto' }}
              />
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Threat-Kategorie">
              <Select options={TI_CATEGORY_OPTS} value={e.category} onChange={(ev) => patch(e.id, 'category', ev.target.value)} disabled={readOnly} />
            </Field>
            <Field label="Threat Actor / Gruppe">
              <Input value={e.actor} onChange={(ev) => patch(e.id, 'actor', ev.target.value)} readOnly={readOnly} placeholder="z.B. APT29" />
            </Field>
            <Field label="Malware / Familie">
              <Input value={e.malware} onChange={(ev) => patch(e.id, 'malware', ev.target.value)} readOnly={readOnly} placeholder="z.B. Cobalt Strike" />
            </Field>
            <Field label="Konfidenz">
              <Select options={TI_CONFIDENCE_OPTS} value={e.confidence} onChange={(ev) => patch(e.id, 'confidence', ev.target.value)} disabled={readOnly} />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}
