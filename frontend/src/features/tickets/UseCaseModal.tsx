import { useEffect, useState, type CSSProperties } from 'react';
import { X, BookMarked, Trash2, Plus } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { useCaseApi, type UseCaseItem } from './useCaseApi';
import { useTranslation } from 'react-i18next';

// Geteilte Use-Case-Bibliothek: einen Use-Case ins Ticket übernehmen oder neuen anlegen.
// Gleiches Overlay-Muster wie VorlagenModal/TemplateModal.

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(520px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 20 };
const LIST: CSSProperties = { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 14px' };
const ITEM: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' };

interface UseCaseModalProps {
  currentValue: string;
  onPick: (value: string) => void;
  onClose: () => void;
}

export function UseCaseModal({ currentValue, onPick, onClose }: UseCaseModalProps) {
  const { t: tr } = useTranslation();
  const [items, setItems] = useState<UseCaseItem[]>([]);
  const [newValue, setNewValue] = useState(currentValue);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const res = await useCaseApi.list();
      setItems(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('ui.useCasesCouldNotLoaded'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function add() {
    const value = newValue.trim();
    if (!value) { setError(tr('ui.pleaseEnterUseCase')); return; }
    setBusy(true);
    setError('');
    try {
      await useCaseApi.create(value);
      setNewValue('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('common.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await useCaseApi.remove(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('ui.deletionFailed'));
    } finally {
      setBusy(false);
    }
  }

  function pick(value: string) {
    onPick(value);
    onClose();
  }

  return (
    // a11y: Backdrop-Klick = reine Maus-Ergänzung; Tastaturpfad ist der fokussierbare X-Schließen-Button im Dialog
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <BookMarked size={17} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14 }}>Use-Case-Bibliothek</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        <div style={LIST}>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>{tr('ui.loading')}</div>}
          {!loading && items.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>{tr('useCase.noneYet')}</div>
          )}
          {items.map((u) => (
            <div key={u.id} style={ITEM}>
              <button
                type="button"
                onClick={() => pick(u.value)}
                style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
              >
                {u.value}
              </button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void remove(u.id)} title={tr('common.delete')} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="z.B. UC-042 – Lateral Movement Detection"
            style={{ flex: 1 }}
          />
          <Button size="sm" variant="success" icon={<Plus size={14} />} disabled={busy} onClick={() => void add()}>
            Anlegen
          </Button>
        </div>
      </div>
    </div>
  );
}
