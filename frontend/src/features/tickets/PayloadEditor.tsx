import { Zap, Trash2, Plus } from 'lucide-react';
import { Button, Field, Input, Textarea, Select, Badge } from '../../components/ui';
import { PAYLOAD_SCHEMA, PAYLOAD_TYPES, type TicketPayloadItem } from './payloadSchema';
import { detectAndParse } from './smartParser';
import { useTranslation } from 'react-i18next';

// Payload-/Artefakt-Editor — Parität zum Ursprungs-Tool: Roh-Text einfügen,
// Smart-Parser erkennt den Typ und befüllt die Schema-Felder vor.

interface PayloadEditorProps {
  value: TicketPayloadItem[];
  onChange: (next: TicketPayloadItem[]) => void;
  readOnly?: boolean;
}

const TYPE_OPTS = [{ value: '', label: '— Typ wählen —' }, ...PAYLOAD_TYPES.map((t) => ({ value: t, label: t }))];

function newPayload(): TicketPayloadItem {
  return { id: crypto.randomUUID(), type: '', raw: '', fields: {}, createdAt: new Date().toISOString() };
}

export function PayloadEditor({ value, onChange, readOnly = false }: PayloadEditorProps) {
  const { t: tr } = useTranslation();
  const update = (id: string, patch: Partial<TicketPayloadItem>) =>
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const parseRaw = (p: TicketPayloadItem, raw: string) => {
    if (!raw.trim()) { update(p.id, { raw, type: '', fields: {} }); return; }
    const result = detectAndParse(raw);
    update(p.id, { raw, type: result.type, fields: result.fields });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {value.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('tickets.noArtefactsYet')}</div>
      )}

      {value.map((p, i) => {
        const schema = PAYLOAD_SCHEMA[p.type] ?? [];
        return (
          <div key={p.id} style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>[{String(i + 1).padStart(2, '0')}]</span>
              <Badge tone={p.type ? 'accent' : 'muted'}>
                {p.type ? <><Zap size={10} style={{ marginRight: 3 }} />{p.type}</> : tr('siem.autoDetection')}
              </Badge>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Select
                  options={TYPE_OPTS}
                  value={p.type}
                  onChange={(e) => update(p.id, { type: e.target.value })}
                  disabled={readOnly}
                />
                {!readOnly && (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => onChange(value.filter((x) => x.id !== p.id))} />
                )}
              </div>
            </div>

            <Field label={tr('ui.rawValueDetectedAutomaticallyPaste')}>
              <Textarea
                className="input-mono"
                value={p.raw}
                onChange={(e) => parseRaw(p, e.target.value)}
                readOnly={readOnly}
                style={{ minHeight: 54 }}
                placeholder="https://… · 185.220.101.5 · d41d8cd9… · powershell -enc … · HKCU\…"
              />
            </Field>

            {schema.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {schema.map((def) => {
                  const common = {
                    value: p.fields[def.key] ?? '',
                    onChange: (e: { target: { value: string } }) => update(p.id, { fields: { ...p.fields, [def.key]: e.target.value } }),
                    readOnly,
                    placeholder: def.placeholder,
                  };
                  return (
                    <div key={def.key} style={def.full ? { gridColumn: '1 / -1' } : undefined}>
                      <Field label={def.label}>
                        {def.input === 'textarea'
                          ? <Textarea {...common} className={def.mono ? 'input-mono' : undefined} style={{ minHeight: 60 }} />
                          : <Input {...common} mono={def.mono} />}
                      </Field>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...value, newPayload()])}>{tr('tickets.addArtefact')}</Button>
      )}
    </div>
  );
}
