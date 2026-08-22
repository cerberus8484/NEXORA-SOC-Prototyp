import { useEffect, useState, type CSSProperties } from 'react';
import { X, BookMarked, Trash2, Download, Save } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { templateApi } from './templateApi';
import { formToTemplateFields, templateToFormPatch, type AnalysisTemplate } from './vorlagenModel';

// Geteilte Analyse-Vorlagen: laden ins Formular oder aktuellen Inhalt als Vorlage speichern.
// Gleiches Overlay-Muster wie TemplateModal.

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(560px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 20 };
const LIST: CSSProperties = { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 14px' };
const ITEM: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' };

interface VorlagenModalProps {
  currentForm: Record<string, string>;
  onLoad: (patch: Record<string, string>) => void;
  onClose: () => void;
}

export function VorlagenModal({ currentForm, onLoad, onClose }: VorlagenModalProps) {
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const res = await templateApi.list();
      setTemplates(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorlagen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function saveCurrent() {
    const name = newName.trim();
    if (!name) { setError('Bitte einen Vorlagennamen eingeben'); return; }
    setBusy(true);
    setError('');
    try {
      await templateApi.create({ name, ...formToTemplateFields(currentForm) });
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await templateApi.remove(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  function load(tpl: AnalysisTemplate) {
    onLoad(templateToFormPatch(tpl));
    onClose();
  }

  return (
    // a11y: Backdrop-Klick = reine Maus-Ergänzung; Tastaturpfad ist der fokussierbare X-Schließen-Button im Dialog
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <BookMarked size={17} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14 }}>Analyse-Vorlagen</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        <div style={LIST}>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>Lädt …</div>}
          {!loading && templates.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
              Noch keine Vorlagen — aktuellen Inhalt unten als Vorlage speichern.
            </div>
          )}
          {templates.map((t) => (
            <div key={t.id} style={ITEM}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
              <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} onClick={() => load(t)}>Laden</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void remove(t.id)} title="Löschen" />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name der neuen Vorlage"
            style={{ flex: 1 }}
          />
          <Button size="sm" variant="success" icon={<Save size={14} />} disabled={busy} onClick={() => void saveCurrent()}>
            Aktuell speichern
          </Button>
        </div>
      </div>
    </div>
  );
}
