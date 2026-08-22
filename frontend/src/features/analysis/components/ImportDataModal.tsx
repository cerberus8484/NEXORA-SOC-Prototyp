import { useRef, useState, type CSSProperties } from 'react';
import { X, FileSearch, ShieldCheck, ListChecks, FileInput, Upload } from 'lucide-react';
import { Button, Badge } from '../../../components/ui';
import { IMPORT_SOURCES, iocsFromParsed, type ParsedEvidence } from '../analysisModel';
import { ticketApi } from '../../tickets/ticketApi';
import { useFocusTrap, useReturnFocus } from '../../../hooks/useFocusTrap';

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 };
const PANEL: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-pop)', width: 'min(860px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: 20 };
const SEL: CSSProperties = { background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13 };
const PREVCOL: CSSProperties = { background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' };
const KV: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '2px 0' };

export type ImportMode = 'evidence' | 'fields' | 'iocs';

interface Props {
  ticketId: string;
  onClose: () => void;
  onImported: (mode: ImportMode, parsed: ParsedEvidence) => void;
}

export function ImportDataModal({ ticketId, onClose, onImported }: Props) {
  const [source, setSource] = useState<string>('Wazuh Alert');
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedEvidence | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A11y: focus trap + Escape + focus-return (WCAG 2.4.3).
  useFocusTrap(panelRef, true, onClose);
  useReturnFocus(true);

  async function doParse() {
    if (!raw.trim()) return;
    setIsLoading(true);
    setParseError(null);
    try {
      const res = await ticketApi.importRaw(ticketId, raw, source);
      setParsed(res.data.evidence);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse-Fehler — bitte erneut versuchen.');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadFile(file: File) { setRaw(await file.text()); }
  const iocs = parsed ? iocsFromParsed(parsed) : [];

  return (
    <div
      style={OVERLAY}
      onClick={onClose}
      aria-hidden="true"
    >
      {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion; ESC via useFocusTrap */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        style={PANEL}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 id="import-modal-title" style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Import Data into Ticket: <span className="mono" style={{ color: 'var(--accent)' }}>{ticketId}</span></h3>
          <button aria-label="Schließen" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>Smart-Parser — <code>POST /v1/tickets/:id/import</code> (Preview, kein Persistieren).</div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            Import Source<br />
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...SEL, marginTop: 4, minWidth: 200 }}>
              {IMPORT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Button variant="primary" icon={<FileSearch size={15} />} onClick={() => void doParse()} disabled={isLoading || !raw.trim()}>{isLoading ? 'Analysiere…' : 'Parse & Preview'}</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.log,.txt,.csv,.xml,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }}
          />
          <Button variant="ghost" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>Datei laden</Button>
        </div>

        <textarea
          value={raw} onChange={(e) => setRaw(e.target.value)}
          placeholder="JSON / Syslog / Firewall-Log / Payload einfügen — oder oben „Datei laden“"
          style={{ width: '100%', minHeight: 120, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 10, fontSize: 12, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
        />

        {parseError && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(var(--danger-rgb,220,38,38),0.12)', border: '1px solid rgba(var(--danger-rgb,220,38,38),0.4)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--danger, #ef4444)' }}>
            {parseError}
          </div>
        )}

        {parsed && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '16px 0 8px' }}>Parsed Preview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <div style={PREVCOL}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Detection</div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>Rule</span><span>{parsed.detection.ruleName}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>Source</span><span>{parsed.detection.sourceSystem}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>Severity</span><span>{parsed.detection.severity}</span></div>
              </div>
              <div style={PREVCOL}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Source</div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>Host</span><span>{parsed.source.host}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>IP</span><span className="mono">{parsed.source.ip}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>User</span><span>{parsed.source.user}</span></div>
              </div>
              <div style={PREVCOL}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Destination</div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>IP</span><span className="mono">{parsed.destination.ip}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>FQDN</span><span>{parsed.destination.fqdn}</span></div>
                <div style={KV}><span style={{ color: 'var(--text-dim)' }}>Port</span><span>{parsed.destination.port}</span></div>
              </div>
              <div style={PREVCOL}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>IoCs ({iocs.length})</div>
                {iocs.slice(0, 5).map((ioc) => <div key={ioc.value} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{ioc.value}</div>)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="ghost" icon={<ListChecks size={14} />} onClick={() => onImported('iocs', parsed)}>Import as IoCs Only</Button>
              <Button variant="ghost" icon={<FileInput size={14} />} onClick={() => onImported('fields', parsed)}>Import &amp; Update Ticket Fields</Button>
              <Button variant="primary" icon={<ShieldCheck size={14} />} onClick={() => onImported('evidence', parsed)}>Import as Evidence</Button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, textAlign: 'right' }}>
              Import speichert zwei Ebenen: <Badge tone="muted">parsedEvidence</Badge> (Analystenansicht) + <Badge tone="muted">rawEvent</Badge> (Nachweis, nur Advanced).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
