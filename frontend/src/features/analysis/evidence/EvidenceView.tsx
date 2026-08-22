// Analysis → Evidence — Master-Detail-Browser der echten Evidence-Records (Mockup-Referenz).
// 4 Zonen: Filter · Records-Liste · Record-Detail · Context-Rail. Quelle ausschließlich echte Daten
// (geparste Primär-Evidence + gesicherte Snapshots + Timeline-Flows). Strukturierte Felder als Standard,
// Raw JSON nur aufklappbar. Keine Fake-Records. Keine neue Parsing-/Backend-Logik.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Boxes, Search, RefreshCw, ChevronDown, ChevronRight, Copy, ShieldAlert, Activity, FileText,
  Network, Cpu, ClipboardList, Database, Gavel,
} from 'lucide-react';
import { Card, Badge, Button, Spinner, type Tone } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline } from '../analysisModel';
import type { RiskModel } from '../deckModel';
import type { DeckSection } from '../deck/AnalysisSubNav';
import { evidenceApi, type EvidenceItem } from '../../evidence/evidenceApi';
import { provenanceTone, prettyRaw } from './evidenceProvenance';
import { buildEvidenceRecords, facetsOf, filterRecords, EMPTY_FILTER, type EvidenceRecord, type EvidenceFilter, type Severity } from './evidenceRecordsModel';

const SEV_TONE: Record<Severity, Tone> = { High: 'danger', Medium: 'warning', Low: 'muted', Info: 'muted' };
const lbl: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const fmtTs = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE'); };
const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 9px' };

function KvRow({ k, v, mono, danger, copy }: { k: string; v?: ReactNode; mono?: boolean; danger?: boolean; copy?: string }) {
  const empty = v === undefined || v === null || v === '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr auto', gap: 10, alignItems: 'baseline', padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)' }}>{k}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : danger ? 'var(--danger)' : 'var(--text)', fontFamily: mono && !empty ? 'var(--font-mono)' : undefined, fontStyle: empty ? 'italic' : 'normal', overflowWrap: 'anywhere', minWidth: 0 }}>{empty ? 'Nicht verfügbar' : v}</span>
      {copy && !empty ? <CopyBtn value={copy} /> : <span />}
    </div>
  );
}
function CopyBtn({ value }: { value: string }) {
  const [c, setC] = useState(false);
  return <button type="button" aria-label="Kopieren" title={c ? 'Kopiert' : 'Kopieren'} onClick={() => { navigator.clipboard?.writeText(value); setC(true); setTimeout(() => setC(false), 1200); }} style={{ background: 'transparent', border: 'none', color: c ? 'var(--success)' : 'var(--text-dim)', cursor: 'pointer', padding: 0 }}><Copy size={13} /></button>;
}
function Block({ title, icon, children, collapsible, defaultOpen = true }: { title: string; icon?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 10, overflow: 'hidden' }}>
      <button type="button" onClick={() => collapsible && setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'var(--bg-card-soft)', border: 'none', padding: '9px 12px', cursor: collapsible ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
        {icon}<span style={{ flex: 1 }}>{title}</span>
        {collapsible && (open ? <ChevronDown size={14} style={{ color: 'var(--text-dim)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} />)}
      </button>
      {open && <div style={{ padding: '10px 12px' }}>{children}</div>}
    </div>
  );
}

function RecordDetail({ r }: { r: EvidenceRecord }) {
  const ev = r.ev;
  const flow = r.flow;
  const item = r.item;
  const raw = prettyRaw(r.raw);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Badge tone={provenanceTone(r.source)}>{r.provenance}</Badge>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.eventType}</span>
        <Badge tone={SEV_TONE[r.severity]}>{r.severity}</Badge>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }} className="mono">{fmtTs(r.time)}</span>
      </div>

      <Block title="Overview" icon={<Activity size={14} style={{ color: 'var(--accent)' }} />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <div>
            <KvRow k="Timestamp" v={fmtTs(r.time)} mono />
            <KvRow k="Event Type" v={r.eventType} />
            <KvRow k="Rule ID" v={r.ruleId} mono copy={r.ruleId} />
            <KvRow k="Level" v={typeof r.level === 'number' ? String(r.level) : (ev?.detection.severity)} />
          </div>
          <div>
            <KvRow k="Source" v={r.provenance} />
            <KvRow k="Agent" v={ev ? (ev.metadata.agentName ? `${ev.metadata.agentName}${ev.metadata.agentId ? ` (${ev.metadata.agentId})` : ''}` : undefined) : undefined} />
            <KvRow k="Log Source / Channel" v={ev?.metadata.logSource || item?.logSource || flow?.protocol} />
            <KvRow k="Collected by" v={item?.collectedBy} />
          </div>
        </div>
      </Block>

      {ev?.process && (
        <Block title="Process Information" icon={<Cpu size={14} style={{ color: 'var(--purple)' }} />}>
          <KvRow k="Image" v={ev.process.image} mono copy={ev.process.image} />
          <KvRow k="Command Line" v={ev.process.commandLine} mono copy={ev.process.commandLine} />
          {r.decoded && <KvRow k="Decoded Command" v={r.decoded} mono danger copy={r.decoded} />}
          <KvRow k="User" v={ev.process.user || ev.source.user} />
          <KvRow k="Logon ID" v={ev.process.logonId} mono />
          <KvRow k="Parent Image" v={ev.process.parentImage} mono />
          <KvRow k="PID / Parent PID" v={ev.process.processId || ev.process.parentProcessId ? `${ev.process.processId ?? '—'} / ${ev.process.parentProcessId ?? '—'}` : undefined} mono />
          <KvRow k="Integrity Level" v={ev.process.integrityLevel} />
          <KvRow k="Working Directory" v={ev.process.currentDirectory} mono />
          {r.hashes.map((h) => <KvRow key={h.algo} k={h.algo} v={h.value} mono copy={h.value} />)}
        </Block>
      )}

      {(ev?.destination.ip || ev?.nat.postNatSourceIp || flow) && (
        <Block title="Network Information" icon={<Network size={14} style={{ color: 'var(--accent)' }} />} collapsible defaultOpen={!ev?.process}>
          <KvRow k="Source IP" v={(ev?.source.ip) ?? flow?.srcIp} mono copy={(ev?.source.ip) ?? flow?.srcIp ?? undefined} />
          <KvRow k="Post-NAT / Public" v={ev?.nat.postNatSourceIp} mono copy={ev?.nat.postNatSourceIp} />
          <KvRow k="Destination IP" v={(ev?.destination.ip) ?? flow?.dstIp} mono copy={(ev?.destination.ip) ?? flow?.dstIp ?? undefined} />
          <KvRow k="Ports (src → dst)" v={[ev?.source.port ?? flow?.srcPort, ev?.destination.port ?? flow?.dstPort].filter((p) => p != null).join(' → ') || undefined} mono />
          <KvRow k="Protocol" v={(ev?.network.protocol || flow?.protocol)?.toUpperCase()} />
          <KvRow k="Action" v={ev?.network.action || flow?.action} />
          <KvRow k="FQDN" v={ev?.destination.fqdn} mono copy={ev?.destination.fqdn} />
        </Block>
      )}

      {ev?.file?.name && (
        <Block title="File Information" icon={<FileText size={14} style={{ color: 'var(--warning)' }} />} collapsible defaultOpen={false}>
          <KvRow k="File Name" v={ev.file.name} mono copy={ev.file.name} />
        </Block>
      )}

      {item && (
        <Block title="Custody / Snapshot" icon={<ShieldAlert size={14} style={{ color: 'var(--success)' }} />} collapsible defaultOpen={false}>
          <KvRow k="Title" v={item.title} />
          <KvRow k="Event ID" v={item.eventId} mono />
          <KvRow k="Query" v={item.query} mono />
          <KvRow k="SHA-256" v={item.sha256} mono copy={item.sha256} />
          <KvRow k="Collected at" v={fmtTs(item.collectedAt)} />
          <KvRow k="Review Status" v={<Badge tone={item.reviewStatus === 'verified' ? 'success' : item.reviewStatus === 'flagged' ? 'danger' : 'muted'}>{item.reviewStatus || 'open'}</Badge>} />
          {item.comment && <KvRow k="Comment" v={item.comment} />}
        </Block>
      )}

      {raw.text && (
        <Block title={`Raw ${raw.isJson ? 'JSON' : 'Event'}`} icon={<Database size={14} style={{ color: 'var(--text-dim)' }} />} collapsible defaultOpen={false}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}><Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={() => navigator.clipboard?.writeText(raw.text)}>Copy</Button></div>
          <pre style={{ margin: 0, maxHeight: 320, overflow: 'auto', background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{raw.text}</pre>
        </Block>
      )}
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  // Aus/An müssen beide klar sichtbar sein: der ganze Chip bekommt im Aus-Zustand
  // einen sichtbaren Rahmen + leichten Hintergrund (statt unsichtbarem weiß-auf-hell),
  // im An-Zustand Akzent-Rahmen + Akzent-Soft. Der Knopf-Track ist in beiden Zuständen
  // kontrastiert (Aus = umrandeter Knopf auf Card-Soft, An = Akzent-Track).
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        background: on ? 'var(--accent-soft)' : 'var(--bg-card-soft)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)', padding: '7px 9px', marginBottom: 6,
        cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500,
        color: on ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      <span>{label}</span>
      <span style={{ width: 32, height: 18, borderRadius: 10, background: on ? 'var(--accent)' : 'var(--bg-input)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 1, left: on ? 15 : 1, width: 14, height: 14, borderRadius: '50%', background: on ? '#fff' : 'var(--text-muted)', border: on ? 'none' : '1px solid var(--border)', boxSizing: 'border-box', transition: 'left .12s' }} />
      </span>
    </button>
  );
}

function RailCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{icon}{title}</div><div style={{ padding: '12px 14px' }}>{children}</div></Card>;
}

export function EvidenceView({ t, ev, tl, ticketId, risk, refreshKey, onOpenSection }: {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; ticketId: string; risk: RiskModel | null; refreshKey: string;
  onOpenSection: (s: DeckSection) => void;
}) {
  const [stored, setStored] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<EvidenceFilter>(EMPTY_FILTER);
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true; setLoading(true);
    evidenceApi.list(ticketId).then((r) => { if (alive) setStored(r.data ?? []); }).catch(() => { if (alive) setStored([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ticketId, refreshKey, reloadKey]);

  const records = useMemo(() => buildEvidenceRecords(t, ev, tl, stored), [t, ev, tl, stored]);
  const facets = useMemo(() => facetsOf(records), [records]);
  const filtered = useMemo(() => filterRecords(records, filter), [records, filter]);
  const selected = filtered.find((r) => r.id === selId) ?? filtered[0] ?? null;
  const set = (p: Partial<EvidenceFilter>) => setFilter((f) => ({ ...f, ...p }));

  if (loading) return <Card style={{ padding: 16 }}><Spinner label="Evidence-Records werden geladen …" /></Card>;
  if (records.length === 0) {
    return (
      <Card style={{ padding: '40px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <Boxes size={32} style={{ color: 'var(--text-dim)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Noch keine Evidence-Records vorhanden</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Dieses Ticket enthält derzeit keine strukturiert importierten Quell-Events oder gesicherten Evidence-Snapshots. Über <strong>Import</strong> oder „Als Evidence sichern" erscheinen sie hier.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 270px minmax(0, 1fr) 280px', gap: 14, alignItems: 'start' }}>
      {/* ── Filter ── */}
      <Card style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Filter</span>
          <button type="button" onClick={() => setFilter(EMPTY_FILTER)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5 }}>Zurücksetzen</button>
        </div>
        <div style={lbl}>Source</div>
        <select value={filter.source} onChange={(e) => set({ source: e.target.value })} style={{ ...inp, marginBottom: 10 }}>
          <option value="all">Alle Quellen</option>{facets.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={lbl}>Event Type</div>
        <select value={filter.eventType} onChange={(e) => set({ eventType: e.target.value })} style={{ ...inp, marginBottom: 10 }}>
          <option value="all">Alle Typen</option>{facets.eventTypes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={lbl}>Severity</div>
        <select value={filter.severity} onChange={(e) => set({ severity: e.target.value })} style={{ ...inp, marginBottom: 12 }}>
          <option value="all">Alle</option>{facets.severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
          <Toggle label="Has MITRE" on={filter.hasMitre} onToggle={() => set({ hasMitre: !filter.hasMitre })} />
          <Toggle label="Has File Hash" on={filter.hasFileHash} onToggle={() => set({ hasFileHash: !filter.hasFileHash })} />
          <Toggle label="Has IP Address" on={filter.hasIp} onToggle={() => set({ hasIp: !filter.hasIp })} />
          <Toggle label="Has User" on={filter.hasUser} onToggle={() => set({ hasUser: !filter.hasUser })} />
        </div>
      </Card>

      {/* ── Records-Liste ── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '11px 12px', borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Evidence Records</span>
            <Badge tone="muted">{filtered.length}</Badge>
            <button type="button" title="Aktualisieren" onClick={() => setReloadKey((k) => k + 1)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><RefreshCw size={14} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-dim)' }} />
            <input value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="Evidence durchsuchen …" style={{ ...inp, paddingLeft: 28 }} aria-label="Evidence durchsuchen" />
          </div>
        </div>
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>
          {filtered.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>Keine Records für diese Filter.</div>
            : filtered.map((r) => {
              const on = selected?.id === r.id;
              return (
                <button key={r.id} type="button" onClick={() => setSelId(r.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--border-soft)', borderLeft: on ? '2px solid var(--accent)' : '2px solid transparent', background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Badge tone={provenanceTone(r.source)}>{r.provenance}</Badge>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.eventType}</span>
                    <Badge tone={SEV_TONE[r.severity]}>{r.severity}</Badge>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="mono">{r.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }} className="mono">{fmtTs(r.time)}</div>
                </button>
              );
            })}
        </div>
        <div style={{ padding: '6px 12px', fontSize: 10.5, color: 'var(--text-dim)', borderTop: '1px solid var(--border-soft)' }}>{filtered.length} von {records.length} Records</div>
      </Card>

      {/* ── Detail ── */}
      <Card style={{ padding: '14px 16px', minHeight: 300 }}>
        {selected ? <RecordDetail r={selected} /> : <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Kein Record ausgewählt.</div>}
      </Card>

      {/* ── Context-Rail ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <RailCard title="Risk & Impact" icon={<Activity size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 54, height: 54, borderRadius: '50%', border: '4px solid var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{risk?.score ?? '—'}</span>
            </div>
            <div style={{ flex: 1, fontSize: 12 }}>
              <KvRow k="Risk Level" v={risk?.businessImpact} />
              <KvRow k="Severity" v={typeof risk?.severity === 'number' ? `${risk.severity}/10` : undefined} />
            </div>
          </div>
        </RailCard>
        <RailCard title="Evidence Context" icon={<ClipboardList size={15} style={{ color: 'var(--accent)' }} />}>
          <KvRow k="Source" v={ev.detection.sourceSystem || t.source} />
          <KvRow k="Agent" v={ev.metadata.agentName || ev.metadata.agentId} />
          <KvRow k="First Seen" v={ev.firstSeen} />
          <KvRow k="Last Seen" v={ev.lastSeen} />
          <KvRow k="Records" v={String(records.length)} />
          <button type="button" onClick={() => onOpenSection('timeline')} style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>View in Timeline →</button>
        </RailCard>
        <RailCard title="MITRE & Rule Context" icon={<ShieldAlert size={15} style={{ color: 'var(--accent)' }} />}>
          <KvRow k="MITRE" v={[ev.metadata.mitreTactic, ev.metadata.mitreTechnique].filter(Boolean).join(' · ') || undefined} />
          <KvRow k="Rule ID" v={ev.detection.ruleId} mono />
          <KvRow k="Severity" v={ev.detection.severity} />
        </RailCard>
        <RailCard title="Quick Actions" icon={<Gavel size={15} style={{ color: 'var(--accent)' }} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => onOpenSection('timeline')} style={{ width: '100%', justifyContent: 'center' }}>View in Timeline</Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenSection('network')} style={{ width: '100%', justifyContent: 'center' }}>View in Network</Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenSection('commands')} style={{ width: '100%', justifyContent: 'center' }}>View in Commands</Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenSection('notes')} style={{ width: '100%', justifyContent: 'center' }}>Add to Notes</Button>
          </div>
        </RailCard>
      </div>
    </div>
  );
}
