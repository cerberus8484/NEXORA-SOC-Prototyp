// Overview-Preview-Karten (Mockup-Layout): kompakte Einstiege in die Detail-Tabs.
// Quelle: ParsedEvidence + korrelierte Timeline/Flows. KEINE Fake-Werte — fehlt etwas, „—".
import { useState, type CSSProperties } from 'react';
import { Shield, FileText, Network, Globe, FileCode, Clock, Monitor, ArrowRight, Cloud, Copy } from 'lucide-react';
import { Badge, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation } from '../analysisModel';
import { parseHashes, fmtBytes } from '../deckModel';
import { deriveConversations } from '../network/networkModel';
import { buildTimelineGroups, CATEGORY_LABEL } from '../timeline/timelineModel';
import { OverviewCard, Row, CardEmpty } from './overviewUi';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';

const ic = { color: 'var(--accent)' };
const fmtTs = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const sha256Of = (hashes?: string) => parseHashes(hashes).find((h) => /sha-?256/i.test(h.algo))?.value;
const baseName = (p?: string) => (p ? p.split(/[\\/]/).pop() || p : undefined);
const truncMid = (v?: string, n = 26) => (!v ? undefined : v.length <= n ? v : `${v.slice(0, n - 6)}…${v.slice(-5)}`);

const FILE_TYPES: Record<string, string> = {
  ps1: 'PowerShell Script', psm1: 'PowerShell Module', exe: 'Executable', dll: 'DLL', sys: 'Driver',
  bat: 'Batch Script', cmd: 'Batch Script', vbs: 'VBScript', js: 'JScript', hta: 'HTML Application',
  tmp: 'Temp File', zip: 'ZIP Archive', rar: 'RAR Archive', docx: 'Word Document', xlsx: i18n.t('tickets.excelFile'), pdf: 'PDF',
};
const fileType = (name?: string): string | undefined => {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  return ext && ext !== name ? FILE_TYPES[ext] : undefined;
};

function CopyBtn({ value }: { value: string }) {
  const { t: tr } = useTranslation();
  const [done, setDone] = useState(false);
  return <button type="button" aria-label={tr('common.copyPath')} title={done ? tr('common.copied') : tr('common.copy')} onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }} style={{ background: 'transparent', border: 'none', color: done ? 'var(--success)' : 'var(--text-dim)', cursor: 'pointer', padding: 2 }}><Copy size={13} /></button>;
}

// ── Reihe 1: Evidence Preview · Event Preview ─────────────────────────────────
export function EvidencePreviewCard({ ev, onFooter }: { ev: ParsedEvidence; onFooter?: () => void }) {
  const path = ev.file?.name;
  const sha = sha256Of(ev.file?.hashes) || sha256Of(ev.process?.hashes);
  return (
    <OverviewCard title="Evidence Preview" icon={<Shield size={15} style={ic} />} footerLabel="View all evidence" onFooter={onFooter}
      headerRight={path ? <CopyBtn value={path} /> : undefined}>
      <Row label="File Path" value={truncMid(path, 34)} mono />
      <Row label="File Name" value={baseName(path)} mono />
      <Row label="File Size" value={undefined} />
      <Row label="Hash (SHA256)" value={truncMid(sha, 30)} mono />
      <Row label="First Seen" value={fmtTs(ev.firstSeen)} />
      <Row label="Created" value={fmtTs(ev.detection.timestamp)} />
      <Row label="File Type" value={fileType(path) ?? ev.payload.type} />
    </OverviewCard>
  );
}

export function EventPreviewCard({ ev, onFooter }: { ev: ParsedEvidence; onFooter?: () => void }) {
  const w = ev.windowsEvent;
  return (
    <OverviewCard title="Event Preview" icon={<FileText size={15} style={ic} />} footerLabel="View event in timeline" onFooter={onFooter}>
      <Row label="Provider" value={w?.provider ?? ev.metadata.logSource} />
      <Row label="Event ID" value={w?.eventId} mono />
      <Row label="Channel" value={w?.channel} />
      <Row label="Computer" value={w?.computer ?? ev.source.host} mono />
      <Row label="Level" value={ev.detection.severity} />
      <Row label="Event" value={ev.detection.description ?? ev.detection.ruleName} />
    </OverviewCard>
  );
}

// ── Reihe 2: Top Conversations · Communication Map ────────────────────────────
const th: CSSProperties = { textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 6px', whiteSpace: 'nowrap' };
const tdc: CSSProperties = { fontSize: 11.5, padding: '5px 6px', borderTop: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };

export function TopConversationsCard({ t, ev, tl, network, tlLoading, onFooter }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null; tlLoading: boolean; onFooter?: () => void;
}) {
  const { t: tr } = useTranslation();
  const rows = deriveConversations(tl, network, 4);
  const source = ev.source.ip || t.srcIp || ev.source.host || '—';
  return (
    <OverviewCard title="Top Conversations (Preview)" icon={<Network size={15} style={ic} />} footerLabel="View all conversations" onFooter={onFooter}>
      {tlLoading ? <CardEmpty>{tr('analysis.loadingTimeline')}</CardEmpty>
        : rows.length === 0 ? <CardEmpty>{tr('text.noCorrelatedNetworkFlowsAvailable')}</CardEmpty>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Source', 'Destination', 'Port / Protocol', 'Events', 'Last Seen'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.destinationIp}:${r.destinationPort ?? ''}-${r.protocol ?? ''}`}>
                    <td style={{ ...tdc, fontFamily: 'var(--font-mono)' }}>{source}</td>
                    <td style={{ ...tdc, fontFamily: 'var(--font-mono)' }}>{r.destinationIp}</td>
                    <td style={{ ...tdc, fontFamily: 'var(--font-mono)' }}>{r.destinationPort ?? '—'} / {(r.protocol || '?').toUpperCase()}</td>
                    <td style={{ ...tdc, fontWeight: 700 }}>{r.events.toLocaleString('de-DE')}</td>
                    <td style={{ ...tdc, color: 'var(--text-muted)' }}>{fmtTs(r.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </OverviewCard>
  );
}

export function CommunicationMapCard({ ev, t, tl, network, onFooter }: {
  ev: ParsedEvidence; t: Ticket; tl: TicketTimeline | null; network?: NetworkCorrelation | null; onFooter?: () => void;
}) {
  const { t: tr } = useTranslation();
  const srcHost = ev.source.host || t.srcIp || ev.source.ip;
  const srcIp = ev.source.ip || t.srcIp;
  const convs = deriveConversations(tl, network, 3);
  const dests = convs.length > 0
    ? convs.map((c) => ({ ip: c.destinationIp, port: c.destinationPort, proto: c.protocol, events: c.events }))
    : (ev.destination.ip || t.dstIp ? [{ ip: (ev.destination.ip || t.dstIp)!, port: ev.destination.port, proto: ev.network.protocol, events: undefined as number | undefined }] : []);
  return (
    <OverviewCard title="Communication Map (Preview)" icon={<Globe size={15} style={ic} />} footerLabel="Open network map" onFooter={onFooter}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ textAlign: 'center', minWidth: 96, flexShrink: 0 }}>
          <Monitor size={24} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{srcHost || '—'}</div>
          {srcIp && <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{srcIp}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {dests.length === 0 ? <CardEmpty>{tr('text.noDirectedConnectionsFromReal')}</CardEmpty>
            : dests.map((d) => (
              <div key={`${d.ip}:${d.port ?? ''}-${d.proto ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <ArrowRight size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <Cloud size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.ip}{d.port ? `:${d.port}` : ''}{d.proto ? ` / ${d.proto.toUpperCase()}` : ''}</div>
                  {typeof d.events === 'number' && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{d.events.toLocaleString('de-DE')} events</div>}
                </div>
              </div>
            ))}
        </div>
      </div>
    </OverviewCard>
  );
}

// ── Reihe 3: Payload Preview · Event Timeline ─────────────────────────────────
type PayloadTab = 'normalized' | 'parsed' | 'raw';
export function PayloadPreviewCard({ ev, onFooter }: { ev: ParsedEvidence; onFooter?: () => void }) {
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<PayloadTab>('normalized');
  const bytes = (ev.network.bytesSent != null || ev.network.bytesReceived != null)
    ? `${ev.network.bytesSent != null ? fmtBytes(ev.network.bytesSent) : '—'} / ${ev.network.bytesReceived != null ? fmtBytes(ev.network.bytesReceived) : '—'}`
    : undefined;
  const tabBtn = (key: PayloadTab): CSSProperties => ({
    background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
    color: tab === key ? 'var(--accent)' : 'var(--text-dim)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '4px 8px',
  });
  return (
    <OverviewCard title="Payload Preview" icon={<FileCode size={15} style={{ color: 'var(--warning)' }} />} footerLabel="View payload analysis" onFooter={onFooter}>
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 8 }}>
        <button type="button" style={tabBtn('normalized')} onClick={() => setTab('normalized')}>Normalized</button>
        <button type="button" style={tabBtn('parsed')} onClick={() => setTab('parsed')}>Parsed</button>
        <button type="button" style={tabBtn('raw')} onClick={() => setTab('raw')}>Raw</button>
      </div>
      {tab === 'normalized' && (
        <>
          <Row label="Source IP" value={ev.source.ip} mono />
          <Row label="Source Port" value={ev.source.port != null ? String(ev.source.port) : undefined} mono />
          <Row label="Destination IP" value={ev.destination.ip} mono />
          <Row label="Destination Port" value={ev.destination.port != null ? String(ev.destination.port) : undefined} mono />
          <Row label="Protocol" value={(ev.network.protocol || ev.network.transport)?.toUpperCase()} />
          <Row label="Bytes (sent/received)" value={bytes} mono />
        </>
      )}
      {tab === 'parsed' && (
        <>
          <Row label="Type" value={ev.payload.type || ev.payload.contentType} />
          <Row label="Method" value={ev.payload.method} />
          <Row label="URL" value={truncMid(ev.payload.url, 34)} mono />
          <Row label="Host Header" value={ev.payload.hostHeader} mono />
          <Row label="User-Agent" value={truncMid(ev.payload.userAgent, 30)} />
          <Row label="Status Code" value={ev.payload.statusCode != null ? String(ev.payload.statusCode) : undefined} mono />
        </>
      )}
      {tab === 'raw' && (
        ev.payload.preview
          ? <pre style={{ margin: 0, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', maxHeight: 140, overflow: 'auto' }}>{ev.payload.preview}</pre>
          : <CardEmpty>{tr('text.noRawPayloadStoredTicket')}</CardEmpty>
      )}
    </OverviewCard>
  );
}

const CAT_TONE: Record<string, Tone> = { process: 'accent', script: 'purple', file: 'warning', detection: 'danger', network: 'success', dns: 'accent' };
export function EventTimelinePreviewCard({ t, ev, tl, network, tlLoading, onFooter }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network?: NetworkCorrelation | null; tlLoading: boolean; onFooter?: () => void;
}) {
  const { t: tr } = useTranslation();
  const groups = buildTimelineGroups(t, ev, tl, network).slice(0, 6);
  return (
    <OverviewCard title="Event Timeline (Preview)" icon={<Clock size={15} style={{ color: 'var(--purple)' }} />} footerLabel="View full timeline" onFooter={onFooter}>
      {tlLoading ? <CardEmpty>{tr('analysis.loadingTimeline')}</CardEmpty>
        : groups.length === 0 ? <CardEmpty>{tr('analysis.noTimelineEventsCanDerived')}</CardEmpty>
        : (
          <div style={{ position: 'relative', paddingLeft: 14 }}>
            <div style={{ position: 'absolute', left: 3, top: 4, bottom: 4, width: 2, background: 'var(--accent)', opacity: 0.35 }} />
            {groups.map((g) => (
              <div key={g.id} style={{ position: 'relative', padding: '4px 0' }}>
                <span style={{ position: 'absolute', left: -14, top: 8, width: 8, height: 8, borderRadius: '50%', background: `var(--${CAT_TONE[g.category] === 'muted' ? 'text-dim' : CAT_TONE[g.category]})` }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', flexShrink: 0 }}>{fmtTs(g.time)}</span>
                  <Badge tone={CAT_TONE[g.category]}>{CATEGORY_LABEL[g.category]}</Badge>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{g.title}</div>
              </div>
            ))}
          </div>
        )}
    </OverviewCard>
  );
}
