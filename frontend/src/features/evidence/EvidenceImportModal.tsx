import { useRef, useState, type CSSProperties } from 'react';
import { X, Upload, FileUp } from 'lucide-react';
import { Field, Input, Textarea, Select, Button } from '../../components/ui';
import { evidenceApi, type EvidenceItem } from './evidenceApi';
import { useTranslation } from 'react-i18next';
import {
  emptyEvidenceDraft, validateEvidenceDraft, validateUploadFile,
  ALLOWED_UPLOAD_EXTENSIONS, EVIDENCE_TYPE_OPTIONS, EVIDENCE_SOURCE_OPTIONS,
} from './evidenceImportModel';

// Manuelles Anlegen eines Evidence-Items (append-only) — POST /v1/evidence.
// Overlay-Muster wie VorlagenModal/TemplateModal.

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(560px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: 20 };

const toOpts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

interface EvidenceImportModalProps {
  initialTicketId?: string;
  onCreated: (item: EvidenceItem) => void;
  onClose: () => void;
}

export function EvidenceImportModal({ initialTicketId = '', onCreated, onClose }: EvidenceImportModalProps) {
  const { t: tr } = useTranslation();
  const [draft, setDraft] = useState(() => emptyEvidenceDraft(initialTicketId));
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  // Datei lokal lesen (FileReader → Text), validieren und in den Draft übernehmen.
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileError = validateUploadFile({ name: file.name, size: file.size });
    if (fileError) { setError(fileError); setFilename(''); return; }
    const reader = new FileReader();
    reader.onerror = () => setError(tr('app.fileCouldNotRead'));
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setFilename(file.name);
      setError('');
      setDraft((d) => ({
        ...d,
        type: 'file_upload',
        title: d.title.trim() || `Import: ${file.name}`,
        rawText: text,
      }));
    };
    reader.readAsText(file);
  }

  async function submit() {
    const validationError = validateEvidenceDraft(draft);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    setError('');
    try {
      const res = await evidenceApi.add({
        ticketId: draft.ticketId.trim(),
        title: draft.title.trim(),
        type: draft.type,
        source: draft.source,
        comment: draft.comment,
        rawText: draft.rawText,
        ...(draft.type === 'file_upload' ? { filename, content: draft.rawText } : {}),
      });
      onCreated(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('common.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    // a11y: Backdrop-Klick = reine Maus-Ergänzung; Tastaturpfad ist der fokussierbare X-Schließen-Button im Dialog
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Upload size={17} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14 }}>{tr('evidence.import')}</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 10px', background: 'var(--bg-input)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <input ref={fileRef} type="file" accept={ALLOWED_UPLOAD_EXTENSIONS.join(',')} onChange={onFilePicked} style={{ display: 'none' }} />
          <Button size="sm" variant="ghost" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>{tr('evidence.importFile')}</Button>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            {filename ? `Geladen: ${filename}` : `${ALLOWED_UPLOAD_EXTENSIONS.join(', ')} · max. 5 MB`}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Ticket-ID (UUID, Pflicht)">
            <Input mono value={draft.ticketId} onChange={set('ticketId')} placeholder="z.B. 3b47cf7c-8bf0-4225-9d05-daac168dab81" />
          </Field>
          <Field label="Titel (Pflicht)">
            <Input value={draft.title} onChange={set('title')} placeholder={tr('app.eGSuspiciousPowershellProcess')} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Typ"><Select options={toOpts(EVIDENCE_TYPE_OPTIONS)} value={draft.type} onChange={set('type')} /></Field>
            <Field label={tr('common.source')}><Select options={toOpts(EVIDENCE_SOURCE_OPTIONS)} value={draft.source} onChange={set('source')} /></Field>
          </div>
          <Field label={tr('app.commentAnalystAssessment')}>
            <Textarea value={draft.comment} onChange={set('comment')} style={{ minHeight: 70 }} placeholder={tr('app.whyDoesMatter')} />
          </Field>
          <Field label="Rohdaten / Raw Event (optional)">
            <Textarea value={draft.rawText} onChange={set('rawText')} className="input-mono" style={{ minHeight: 110 }} placeholder={tr('tickets.rawInputPlaceholder')} />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel2')}</Button>
          <Button variant="success" size="sm" icon={<Upload size={14} />} disabled={busy} onClick={() => void submit()}>
            {busy ? tr('common.saving') : tr('evidence.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
