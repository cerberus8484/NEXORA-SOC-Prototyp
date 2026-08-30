import { useState, type CSSProperties } from 'react';
import { X, Zap, Check } from 'lucide-react';
import { Button, Textarea, Select } from '../../components/ui';
import { ticketApi, type ImportRawResponse } from './ticketApi';
import { rawImportToFormPatch, rawImportToPayloads } from './rawImportHelpers';
import type { TicketPayloadItem } from './payloadSchema';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

// Smart-Parser-Import-Modal: Analyst klebt Roh-Text (IP, Hash, URL, Command …)
// → Backend (POST /tickets/:id/import) parst + normalisiert → Vorschau → Übernehmen.

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20,
};
const PANEL: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)',
  width: 'min(640px, 96vw)', maxHeight: '90vh',
  display: 'flex', flexDirection: 'column', padding: 20, gap: 14,
};
const PREVIEW: CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--border-soft)',
  borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 12,
  fontFamily: 'var(--font-mono)', lineHeight: 1.5, overflowY: 'auto', maxHeight: 220,
};

const sourceOpts = () => [
  { value: 'manual', label: i18n.t('ui.addedManually') },
  { value: 'Wazuh Alert', label: 'Wazuh Alert' },
  { value: 'Firewall Log', label: 'Firewall Log' },
  { value: 'SIEM', label: 'SIEM Export' },
  { value: 'Email', label: 'E-Mail / Phishing' },
  { value: 'Endpoint', label: 'Endpoint / EDR' },
];

export interface ImportRawResult {
  formPatch: Record<string, string>;
  payloads: TicketPayloadItem[];
}

interface ImportRawModalProps {
  ticketId: string;
  onApply: (result: ImportRawResult) => void;
  onClose: () => void;
}

export function ImportRawModal({ ticketId, onApply, onClose }: ImportRawModalProps) {
  const { t: tr } = useTranslation();
  const [raw, setRaw] = useState('');
  const [sourceType, setSourceType] = useState('manual');
  const [result, setResult] = useState<ImportRawResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function parse() {
    const trimmed = raw.trim();
    if (!trimmed) { setError(tr('ui.pleaseEnterRawText')); return; }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const resp = await ticketApi.importRaw(ticketId, trimmed, sourceType);
      setResult(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('tickets.smartParserFailed'));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    onApply({
      formPatch: rawImportToFormPatch(result),
      payloads: rawImportToPayloads(result, raw.trim()),
    });
    onClose();
  }

  const parsedType = result?.data?.type;
  const parsedIocs = result?.data?.iocs ?? [];

  return (
    // a11y: Backdrop-Klick = reine Maus-Ergänzung; Tastaturpfad ist der fokussierbare X-Schließen-Button im Dialog
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={PANEL}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Zap size={17} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14 }}>{tr('tickets.smartParserTitle')}</strong>
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>

        {/* Erklärung */}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{tr('tickets.smartParserIntro')}</p>

        {/* Quelle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>{tr('common.source')}</label>
          <Select
            options={sourceOpts()}
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          />
        </div>

        {/* Roh-Text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>Roh-Text / Artefakt</label>
          <Textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setResult(null); setError(''); }}
            placeholder="192.168.241.50&#10;d41d8cd98f00b204e9800998ecf8427e&#10;https://evil.example.com/x.exe&#10;HKCU\Software\Run\updater"
            style={{ minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
            {error}
          </div>
        )}

        {/* Vorschau */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>
              Erkannter Typ: <span style={{ color: 'var(--accent)' }}>{parsedType ?? '—'}</span>
              {parsedIocs.length > 0 && (
                <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
                  {parsedIocs.length} IOC{parsedIocs.length !== 1 ? 's' : ''} extrahiert
                </span>
              )}
            </div>
            <div style={PREVIEW}>
              {parsedIocs.length > 0
                ? parsedIocs.map((ioc) => `[${ioc.type}]  ${ioc.value}`).join('\n')
                : <span style={{ color: 'var(--text-muted)' }}>{tr('text.noIocsExtracted')}</span>
              }
            </div>
          </div>
        )}

        {/* Aktionen */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <Button variant="ghost" onClick={onClose}>{tr('common.cancel2')}</Button>
          {!result ? (
            <Button variant="primary" icon={<Zap size={14} />} disabled={busy || !raw.trim()} onClick={() => void parse()}>
              {busy ? 'Parst …' : 'Parsen'}
            </Button>
          ) : (
            <Button variant="success" icon={<Check size={14} />} onClick={apply}>{tr('common.apply')}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
