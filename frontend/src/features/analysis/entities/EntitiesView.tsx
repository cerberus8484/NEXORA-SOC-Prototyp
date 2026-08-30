// Analysis → Entities — echte Ermittlungsübersicht: Relationship-Graph + Entity-Tabellen.
// Quelle: deduplizierte EntityItem-Liste (deckModel) + ParsedEvidence (buildEntityGraph).
// KEINE erfundenen Entities/Confidence/MITRE/Reputation. Confidence/Evidence = Beobachtungstiefe.
// Fehlende Werte als „—". Mockup-Referenz: Entity Graph oben, 6 Tabellen im responsiven Raster.
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  Monitor, User, Cpu, FileText, Hash, Globe, Link2, Network as NetworkIcon,
  Boxes, AlertTriangle, Crosshair, Share2, type LucideIcon,
} from 'lucide-react';
import { Card } from '../../../components/ui';
import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence } from '../analysisModel';
import type { EntityItem, EntityKind } from '../deckModel';
import { useTranslation } from 'react-i18next';
import {
  buildEntityGraph, entityRowsOfKind, entitiesOfInterest, mitreLinkedEntities,
  type EntityRow, type ConfidenceLevel, type GraphNode, type GraphRole,
} from './entitiesModel';

// ── geteilte Styles + Maps ────────────────────────────────────────────────────
const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' };
const th: CSSProperties = { fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, textAlign: 'left', padding: '0 8px 6px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
const td: CSSProperties = { fontSize: 11, color: 'var(--text)', padding: '6px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', verticalAlign: 'middle' };

const KIND_COLOR: Record<EntityKind, string> = {
  host: 'var(--accent)', user: 'var(--purple)', process: 'var(--warning)',
  file: 'var(--danger)', hash: 'var(--danger)', ip: 'var(--accent)',
  domain: 'var(--success)', url: 'var(--success)', mac: 'var(--text-muted)', other: 'var(--text-muted)',
};
const KIND_ICON: Record<EntityKind, LucideIcon> = {
  host: Monitor, user: User, process: Cpu, file: FileText, hash: Hash,
  ip: Globe, domain: Globe, url: Link2, mac: NetworkIcon, other: Boxes,
};

const CONF_COLOR: Record<ConfidenceLevel, string> = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--text-muted)' };
const CONF_LABEL: Record<ConfidenceLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };

const fmtTs = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Section({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <Card style={{ padding: 0, overflow: 'hidden' }}><div style={head}>{icon}<span style={{ flex: 1 }}>{title}</span>{right}</div><div style={{ padding: '12px 14px' }}>{children}</div></Card>;
}

function ConfCell({ value }: { value: ConfidenceLevel | null }) {
  if (!value) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  return <span style={{ color: CONF_COLOR[value], fontWeight: 700 }}>{CONF_LABEL[value]}</span>;
}
function NumCell({ value }: { value: number | null }) {
  return value == null ? <span style={{ color: 'var(--text-dim)' }}>—</span> : <span className="mono" style={{ fontWeight: 700 }}>{value}</span>;
}
function EntityCell({ kind, value }: { kind: EntityKind; value: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: KIND_COLOR[kind], flexShrink: 0 }} />
      <span className="mono" title={value} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    </span>
  );
}

interface Col { label: string; align?: 'right' }
// Keyed Row-Modell: stabile Row-Identität (key) statt Array-Index — Spalten sind fix
// und werden über ihr Label adressiert (kein Index-Key, keine Reorder-Verwechslung).
interface DataRow { key: string; cells: ReactNode[] }
function DataTable({ cols, rows, empty }: { cols: Col[]; rows: DataRow[]; empty: string }) {
  if (rows.length === 0) return <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '6px 2px' }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 340 }}>
        <thead><tr>{cols.map((c) => <th key={c.label} style={{ ...th, textAlign: c.align ?? 'left' }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, ci) => (
                <td key={cols[ci].label} style={{ ...td, textAlign: cols[ci].align ?? 'left', maxWidth: ci === 0 ? 190 : undefined, overflow: ci === 0 ? 'hidden' : undefined, textOverflow: ci === 0 ? 'ellipsis' : undefined }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Standard-Entity-Tabelle (Entity · Type · Confidence · First · Last · Evidence) ──
function EntityTable({ title, icon, rows }: { title: string; icon: ReactNode; rows: EntityRow[] }) {
  const { t: tr } = useTranslation();
  const cols: Col[] = [{ label: 'Entity' }, { label: 'Type' }, { label: 'Confidence' }, { label: 'First Seen' }, { label: 'Last Seen' }, { label: 'Evidence', align: 'right' }];
  const body: DataRow[] = rows.map((r) => ({
    key: `${r.kind}:${r.value}`,
    cells: [
      <EntityCell key="entity" kind={r.kind} value={r.value} />,
      <span key="type" style={{ color: 'var(--text-muted)' }}>{r.typeLabel}</span>,
      <ConfCell key="conf" value={r.confidence} />,
      <span key="first" style={{ color: 'var(--text-muted)' }}>{fmtTs(r.firstSeen)}</span>,
      <span key="last" style={{ color: 'var(--text-muted)' }}>{fmtTs(r.lastSeen)}</span>,
      <NumCell key="evidence" value={r.evidence} />,
    ],
  }));
  return (
    <Section title={title} icon={icon} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{rows.length}</span>}>
      <DataTable cols={cols} rows={body} empty={tr('text.noEntitiesKind')} />
    </Section>
  );
}

// ── Relationship-Graph ─────────────────────────────────────────────────────────
const GRAPH_W = 980;
const COL_X: Record<GraphRole, number> = { actor: 120, host: 380, process: 620, artifact: 860 };
const ROW_H = 92;
const NODE_R = 26;

function layoutGraph(nodes: GraphNode[]): { pos: Map<string, { x: number; y: number }>; height: number } {
  const roles: GraphRole[] = ['actor', 'host', 'process', 'artifact'];
  const maxN = Math.max(1, ...roles.map((r) => nodes.filter((n) => n.role === r).length));
  const height = maxN * ROW_H + 16;
  const midY = height / 2;
  const pos = new Map<string, { x: number; y: number }>();
  for (const role of roles) {
    const list = nodes.filter((n) => n.role === role);
    list.forEach((n, i) => pos.set(n.id, { x: COL_X[role], y: midY + (i - (list.length - 1) / 2) * ROW_H }));
  }
  return { pos, height };
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />{label}</span>;
}

function RelationshipGraph({ t, ev }: { t: Ticket; ev: ParsedEvidence }) {
  const { t: tr } = useTranslation();
  const graph = buildEntityGraph(t, ev);
  const right = <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{graph.nodes.length} Knoten · {graph.edges.length} Beziehungen</span>;

  if (graph.nodes.length === 0) {
    return (
      <Section title="Entity Graph / Relationship Map" icon={<Share2 size={15} style={{ color: 'var(--accent)' }} />} right={right}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '14px 2px' }}>{tr('analysis.noLinkedNodesCanDerived')}</div>
      </Section>
    );
  }

  const { pos, height } = layoutGraph(graph.nodes);

  return (
    <Section title="Entity Graph / Relationship Map" icon={<Share2 size={15} style={{ color: 'var(--accent)' }} />} right={right}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: GRAPH_W, height, margin: '0 auto' }}>
          <svg width={GRAPH_W} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
            <defs>
              <marker id="ent-arrow-o" markerWidth="7" markerHeight="7" refX="5.5" refY="2.5" orient="auto"><path d="M0,0 L5.5,2.5 L0,5 Z" fill="var(--text-muted)" /></marker>
              <marker id="ent-arrow-i" markerWidth="7" markerHeight="7" refX="5.5" refY="2.5" orient="auto"><path d="M0,0 L5.5,2.5 L0,5 Z" fill="var(--text-dim)" /></marker>
            </defs>
            {graph.edges.map((e) => {
              const a = pos.get(e.from); const b = pos.get(e.to);
              if (!a || !b) return null;
              const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len; const uy = dy / len;
              const x1 = a.x + ux * NODE_R; const y1 = a.y + uy * NODE_R;
              const x2 = b.x - ux * (NODE_R + 6); const y2 = b.y - uy * (NODE_R + 6);
              const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
              const color = e.inferred ? 'var(--text-dim)' : 'var(--text-muted)';
              const w = e.label.length * 5.6 + 10;
              return (
                <g key={`${e.from}-${e.to}-${e.label}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} strokeDasharray={e.inferred ? '5 4' : undefined} markerEnd={`url(#ent-arrow-${e.inferred ? 'i' : 'o'})`} />
                  <rect x={mx - w / 2} y={my - 8} width={w} height={15} rx={3} fill="var(--bg-card)" />
                  <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fill="var(--text-dim)">{e.label}</text>
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((n) => {
            const p = pos.get(n.id); if (!p) return null;
            const color = KIND_COLOR[n.kind]; const Icon = KIND_ICON[n.kind];
            return (
              <Fragment key={n.id}>
                <div style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -50%)', width: NODE_R * 2, height: NODE_R * 2, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${color} 14%, var(--bg-card))`, border: `2px solid ${color}`, boxSizing: 'border-box' }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <div style={{ position: 'absolute', left: p.x, top: p.y + NODE_R + 4, transform: 'translateX(-50%)', width: 150, textAlign: 'center', pointerEvents: 'none' }}>
                  <div className="mono" title={n.label} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</div>
                  {n.sub && <div style={{ fontSize: 9.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.sub}</div>}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      {/* Legende: Typen + Kantenart */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)', fontSize: 10.5, color: 'var(--text-muted)' }}>
        <LegendDot color="var(--accent)" label="Host / IP" />
        <LegendDot color="var(--purple)" label="User" />
        <LegendDot color="var(--warning)" label="Process" />
        <LegendDot color="var(--danger)" label="File / Hash" />
        <LegendDot color="var(--success)" label="Domain / URL" />
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--text-muted)" strokeWidth="1.5" /></svg> Observed</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 4" /></svg> Inferred</span>
      </div>
    </Section>
  );
}

// ── Haupt-View ─────────────────────────────────────────────────────────────────
export function EntitiesView({ t, ev, entities }: { t: Ticket; ev: ParsedEvidence; entities: EntityItem[] }) {
  const { t: tr } = useTranslation();
  if (entities.length === 0) {
    return (
      <Card style={{ padding: '40px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <Boxes size={32} style={{ color: 'var(--text-dim)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{tr('analysis.noEntityEvidenceYet')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{tr('analysis.noEntities')}</div>
        </div>
      </Card>
    );
  }

  const hostsUsers = entityRowsOfKind(entities, ['host', 'user', 'mac']);
  const files = entityRowsOfKind(entities, ['file', 'hash']);
  const processes = entityRowsOfKind(entities, ['process']);
  const network = entityRowsOfKind(entities, ['ip', 'domain', 'url']);
  const interest = entitiesOfInterest(entities);
  const mitre = mitreLinkedEntities(ev, entities);

  const ic = (C: LucideIcon) => <C size={15} style={{ color: 'var(--accent)' }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RelationshipGraph t={t} ev={ev} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <EntityTable title="Hosts & Users" icon={ic(Monitor)} rows={hostsUsers} />
        <EntityTable title="Files & Hashes" icon={ic(FileText)} rows={files} />
        <EntityTable title="Processes / Tools" icon={ic(Cpu)} rows={processes} />
        <EntityTable title="IPs / Domains / URLs" icon={ic(Globe)} rows={network} />

        {/* MITRE-Linked Entities — nur reale Ticket-Technik */}
        <Section title="MITRE-Linked Entities" icon={<Crosshair size={15} style={{ color: 'var(--accent)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{mitre.length}</span>}>
          <DataTable
            cols={[{ label: 'Entity' }, { label: 'Technique' }, { label: 'Tactic' }, { label: 'Confidence' }, { label: 'Evidence', align: 'right' }]}
            rows={mitre.map((m): DataRow => ({
              key: `${m.value}:${m.technique}`,
              cells: [
                <span key="entity" className="mono" title={m.value} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.value}</span>,
                <span key="technique" className="mono" style={{ color: 'var(--warning)', fontWeight: 700 }}>{m.technique}</span>,
                <span key="tactic" style={{ color: 'var(--text-muted)' }}>{m.tactic ?? '—'}</span>,
                <ConfCell key="conf" value={m.confidence} />,
                <NumCell key="evidence" value={m.evidence} />,
              ],
            }))}
            empty={tr('text.noAttCkTechniqueRecorded')}
          />
        </Section>

        {/* Entities of Interest — transparente Triage-Heuristik, keine erfundene Reputation */}
        <Section title="Entities of Interest" icon={<AlertTriangle size={15} style={{ color: 'var(--warning)' }} />} right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{interest.length}</span>}>
          <DataTable
            cols={[{ label: 'Entity' }, { label: 'Type' }, { label: 'Reason' }, { label: 'Confidence' }, { label: 'Evidence', align: 'right' }]}
            rows={interest.map((r): DataRow => ({
              key: `${r.kind}:${r.value}`,
              cells: [
                <EntityCell key="entity" kind={r.kind} value={r.value} />,
                <span key="type" style={{ color: 'var(--text-muted)' }}>{r.typeLabel}</span>,
                <span key="reason" style={{ color: 'var(--text-muted)' }}>{r.reason}</span>,
                <ConfCell key="conf" value={r.confidence} />,
                <NumCell key="evidence" value={r.evidence} />,
              ],
            }))}
            empty={tr('text.noExternallyDirectedEntities')}
          />
        </Section>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{tr('analysis.entitiesNote')}</div>
    </div>
  );
}
