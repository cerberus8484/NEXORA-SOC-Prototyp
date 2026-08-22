// Evidence Export — Export-Builder im Mockup-Layout. NUR echte Exporte sind aktiv: JSON (Backend,
// Chain-of-Custody/SHA-256), PDF/TXT/Markdown (clientseitig), Case Note. Nicht gestützte Optionen
// (CSV/ZIP, Redaction-Engine, Scheduling, Save Template) sind klar als „geplant" deaktiviert —
// kein Fake-Erfolg. Der Scope filtert den Report-Inhalt wirklich.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useAutoResetFlag } from '../../../hooks/useAutoResetFlag';
import {
  Check, ClipboardCopy, Download, FileDown, FileText, StickyNote, Braces, Table, Package,
  ShieldCheck, Lock, CalendarClock, Save, Layers,
} from 'lucide-react';
import { Button, Badge } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { TicketTimeline, Ioc } from '../analysisModel';
import type { EntityItem, SummaryBullet } from '../deckModel';
import { downloadReportPdf } from '../reportPrint';
import {
  exportScopeItems, selectedCount, buildScopedMarkdown, estimateBytes, fmtBytes, FULL_SCOPE,
  type ExportScope,
} from '../export/exportModel';
import { DeckCard, Hint, KV } from './deckUi';

type Format = 'pdf' | 'json' | 'markdown' | 'txt';
interface FormatDef { key: Format | 'csv' | 'zip'; label: string; desc: string; icon: ReactNode; enabled: boolean }
const FORMATS: FormatDef[] = [
  { key: 'pdf', label: 'PDF Report', desc: 'Lesbarer Report mit Summary & Details', icon: <FileText size={15} />, enabled: true },
  { key: 'json', label: 'JSON Bundle', desc: 'Maschinenlesbar · Chain-of-Custody (SHA-256)', icon: <Braces size={15} />, enabled: true },
  { key: 'markdown', label: 'Markdown', desc: 'Report als .md', icon: <FileText size={15} />, enabled: true },
  { key: 'txt', label: 'TXT Report', desc: 'Reiner Text', icon: <FileDown size={15} />, enabled: true },
  { key: 'csv', label: 'CSV (Tables)', desc: 'Tabellen — geplant', icon: <Table size={15} />, enabled: false },
  { key: 'zip', label: 'ZIP Package', desc: 'Archiv mit Dateien — geplant', icon: <Package size={15} />, enabled: false },
];
const TLP_OPTIONS = ['TLP: RED', 'TLP: AMBER', 'TLP: GREEN', 'TLP: CLEAR'];
const REDACTIONS = ['PII (Namen, E-Mails)', 'Credentials (Passwörter, Token)', 'Interne Notizen', 'Source-IP-Adressen'];

const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };

function downloadText(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function DisabledToggle() {
  return <span style={{ width: 30, height: 16, borderRadius: 999, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', display: 'inline-block', flexShrink: 0 }} />;
}

export function EvidenceExportSection({ t, bullets, iocs, entities, tl, currentUser, onExportJson, onCreateCaseNote, caseNoteSaved }: {
  t: Ticket; bullets: SummaryBullet[]; iocs: Ioc[]; entities: EntityItem[]; tl: TicketTimeline | null;
  currentUser?: string;
  onExportJson: () => void;
  onCreateCaseNote: (text: string) => void;
  caseNoteSaved: boolean;
}) {
  const [scope, setScope] = useState<ExportScope>(FULL_SCOPE);
  const [format, setFormat] = useState<Format>('pdf');
  const [classification, setClassification] = useState('TLP: AMBER');
  const [watermark, setWatermark] = useState(`Nexora SOC — ${t.ticketNr || t.id} — Confidential`);
  const [copied, triggerCopied] = useAutoResetFlag(2500);

  const items = exportScopeItems(bullets, iocs, entities, tl, t);
  const selected = selectedCount(items, scope);
  const md = buildScopedMarkdown(t, bullets, iocs, entities, tl, scope, { classification, watermark, preparedBy: currentUser });
  const size = fmtBytes(estimateBytes(md));
  const filename = `report-${t.ticketNr || t.id}`;
  const formatLabel = FORMATS.find((f) => f.key === format)?.label ?? '—';

  function doExport() {
    if (format === 'pdf') downloadReportPdf(filename, md);
    else if (format === 'json') onExportJson();
    else if (format === 'markdown') downloadText(`${filename}.md`, md, 'text/markdown');
    else downloadText(`${filename}.txt`, md, 'text/plain;charset=utf-8');
  }
  const toggleScope = (k: keyof ExportScope) => setScope((s) => ({ ...s, [k]: !s[k] }));

  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' };
  const radioRow = (active: boolean, enabled: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 'var(--radius-sm)', marginBottom: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-soft)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--bg-card-soft)',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={grid}>
        {/* 1. Export Package Builder */}
        <DeckCard title="1. Export Package Builder" icon={<Layers size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>Wähle die Abschnitte für das Export-Paket.</div>
          {items.map((it) => (
            <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
              <input type="checkbox" checked={scope[it.key]} onChange={() => toggleScope(it.key)} />
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text)' }}>{it.label}</span>
              <Badge tone="muted">{it.count}</Badge>
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span style={lbl}>Ausgewählte Punkte</span><Badge tone="accent">{selected}</Badge>
          </div>
        </DeckCard>

        {/* 2. Export Options */}
        <DeckCard title="2. Export Options" icon={<Download size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>Format & Verpackung wählen.</div>
          {FORMATS.map((f) => {
            const active = f.key === format;
            return (
              <div
                key={f.key}
                role="button"
                tabIndex={f.enabled ? 0 : -1}
                onClick={() => f.enabled && setFormat(f.key as Format)}
                onKeyDown={(e) => { if (f.enabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFormat(f.key as Format); } }}
                style={radioRow(active, f.enabled)}
                title={f.enabled ? '' : 'Noch nicht verfügbar'}
              >
                <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}>{f.icon}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{f.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>{f.desc}</span>
                </span>
                {!f.enabled && <Badge tone="muted">geplant</Badge>}
                {active && <Check size={15} style={{ color: 'var(--accent)' }} />}
              </div>
            );
          })}
        </DeckCard>

        {/* 5. Preview / Export Summary */}
        <DeckCard title="Preview / Export Summary" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />}>
          <KV label="Export Name" value={`${filename}`} mono />
          <KV label="Case" value={t.ticketNr || t.id.slice(0, 8)} mono />
          <KV label="Prepared By" value={currentUser || '—'} />
          <KV label="Format" value={formatLabel} />
          <KV label="Estimated Size" value={size} />
          <KV label="Selected Items" value={selected} />
          <KV label="Classification" value={classification} />
          <KV label="Chain-of-Custody" value={format === 'json' ? 'Inklusive (SHA-256)' : 'Nur im JSON-Bundle'} />
          <Hint>JSON-Export nutzt den Backend-Evidence-Export inkl. Chain-of-Custody (SHA-256). PDF/MD/TXT werden clientseitig aus dem ausgewählten Scope erzeugt.</Hint>
        </DeckCard>
      </div>

      {/* 3. Export Contents */}
      <DeckCard title="3. Export Contents" icon={<Layers size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead><tr>{['Content Type', 'Description', 'Items', 'Include'].map((h, i) => <th key={h} style={{ ...lbl, fontWeight: 600, textAlign: i === 2 ? 'right' : i === 3 ? 'center' : 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, padding: '7px 8px', borderBottom: '1px solid var(--border-soft)' }}>{it.label}</td>
                  <td style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '7px 8px', borderBottom: '1px solid var(--border-soft)' }}>{it.description}</td>
                  <td style={{ fontSize: 12, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border-soft)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{it.count}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--border-soft)', textAlign: 'center' }}>
                    <input type="checkbox" checked={scope[it.key]} onChange={() => toggleScope(it.key)} aria-label={`${it.label} einschließen`} />
                  </td>
                </tr>
              ))}
              <tr><td style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', padding: '8px' }}>Total (ausgewählt)</td><td /><td style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', padding: '8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{selected}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </DeckCard>

      {/* 4. Redaction & Sharing Controls */}
      <DeckCard title="4. Redaction & Sharing Controls" icon={<ShieldCheck size={15} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
          <div>
            <div style={{ ...lbl, marginBottom: 8 }}>Redaction <Badge tone="muted">geplant</Badge></div>
            {REDACTIONS.map((r) => (
              <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', opacity: 0.6 }}>
                <DisabledToggle /><Lock size={12} style={{ color: 'var(--text-dim)' }} /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r}</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>Redaction-Engine noch nicht im Backend — bewusst deaktiviert.</div>
          </div>
          <div>
            <div style={{ ...lbl, marginBottom: 6 }}>Sharing Classification</div>
            <select value={classification} onChange={(e) => setClassification(e.target.value)} style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 10px' }}>
              {TLP_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <div style={{ ...lbl, margin: '12px 0 6px' }}>Export Watermark</div>
            <input value={watermark} onChange={(e) => setWatermark(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12, padding: '7px 10px' }} />
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>Classification & Watermark werden in den Report-Header/-Footer geschrieben (wirksam).</div>
          </div>
        </div>
      </DeckCard>

      {/* Report-Vorschau */}
      <DeckCard title="Report-Vorschau (Scope-gefiltert)" icon={<FileText size={15} style={{ color: 'var(--text-dim)' }} />}>
        <pre style={{ margin: 0, maxHeight: 320, overflow: 'auto', background: 'var(--bg-card-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 11.5, color: 'var(--text)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{md}</pre>
      </DeckCard>

      {/* Footer-Aktionen */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button variant="ghost" size="sm" icon={<Save size={13} />} disabled title="Templates noch nicht verfügbar">Save Template</Button>
        <Button variant="ghost" size="sm" icon={<CalendarClock size={13} />} disabled title="Scheduling noch nicht verfügbar">Schedule Export</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon={copied ? <Check size={13} /> : <ClipboardCopy size={13} />} onClick={() => { navigator.clipboard?.writeText(md); triggerCopied(); }}>{copied ? 'Kopiert' : 'Copy'}</Button>
        <Button variant="ghost" size="sm" icon={caseNoteSaved ? <Check size={13} /> : <StickyNote size={13} />} disabled={caseNoteSaved} onClick={() => onCreateCaseNote(md)}>{caseNoteSaved ? 'Case Note erstellt' : 'Create Case Note'}</Button>
        <Button variant="primary" size="sm" icon={<Download size={13} />} onClick={doExport}>Preview &amp; Export ({formatLabel})</Button>
      </div>
    </div>
  );
}
