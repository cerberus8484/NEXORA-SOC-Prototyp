import { useState, type CSSProperties } from 'react';
import { FileText, Save } from 'lucide-react';
import { Card, CardHeader, CardBody, Button } from '../../components/ui';
import type { HuntNote } from './huntApi';
import { useTranslation } from 'react-i18next';

// P_TRUST_1 · A3 — Notizen sind append-only HuntNote[] (kein editierbarer String-Blob).
// Liste zeigt Inhalt + Zeitstempel (lesbar, kein [object Object]); analyst+ kann eine
// NEUE Notiz hinzufügen (POST → Reload in der Page).
type Props = { notes: HuntNote[]; canAct: boolean; onAdd: (content: string) => Promise<void> };

const ta: CSSProperties = {
  width: '100%', minHeight: 70, background: 'var(--bg-input)', border: '1px solid var(--border-soft)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 10, fontSize: 13,
  fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box',
};

export function HuntNotesPanel({ notes, canAct, onAdd }: Props) {
  const { t: tr } = useTranslation();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      await onAdd(content);
      setDraft('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FileText size={16} /> Notizen ({notes.length})</span>} />
      <CardBody>
        {notes.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('analysis.noNotesYet')}</div>
        ) : (
          notes.map((n) => (
            <div key={n.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '6px 0' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{n.content}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString('de-DE')}</div>
            </div>
          ))
        )}
        {canAct && (
          <div style={{ marginTop: 10 }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr('label.newNote')} aria-label={tr('label.newNote2')} style={ta} />
            <div style={{ marginTop: 6 }}>
              <Button size="sm" variant="ghost" icon={<Save size={13} />} disabled={saving || !draft.trim()} onClick={() => void add()}>
                {saving ? '…' : tr('label.addNote')}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
