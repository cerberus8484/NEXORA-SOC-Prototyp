// Linke Subnavigation des Analyst Decks — Unterseiten des aktiven Tickets.
import type { ReactNode } from 'react';
import {
  LayoutDashboard, AlertTriangle, Clock, Network, FileCode, Terminal,
  Boxes, ListChecks, Download, FileText, History, BookOpen, ClipboardList, Bot,
} from 'lucide-react';
import { Card } from '../../../components/ui';

export type DeckSection =
  | 'overview' | 'iocs' | 'timeline' | 'network' | 'payloads' | 'commands'
  | 'entities' | 'evidence' | 'ki_analysis' | 'export' | 'notes' | 'history' | 'playbooks' | 'report';

// primary = erscheint auch in der horizontalen Top-Nav (Kern-Arbeitsbereiche, wie im Referenz-Deck).
// Reihenfolge: Overview · Timeline · Network & NAT · Payloads · Commands · Entities · Evidence · KI Analyse · Report · Notes
// Zusätzlich erreichbar: IoCs & Decision · Evidence Export · History · Playbooks
export const DECK_NAV_ITEMS: { id: DeckSection; label: string; icon: ReactNode; primary?: boolean }[] = [
  { id: 'overview',     label: 'Overview',       icon: <LayoutDashboard size={14} />, primary: true },
  { id: 'timeline',     label: 'Timeline',        icon: <Clock size={14} />,           primary: true },
  { id: 'network',      label: 'Network & NAT',   icon: <Network size={14} />,         primary: true },
  { id: 'payloads',     label: 'Payloads',         icon: <FileCode size={14} />,        primary: true },
  { id: 'commands',     label: 'Commands',         icon: <Terminal size={14} />,        primary: true },
  { id: 'entities',     label: 'Entities',         icon: <Boxes size={14} />,           primary: true },
  { id: 'evidence',     label: 'Evidence',         icon: <ListChecks size={14} />,      primary: true },
  { id: 'ki_analysis',  label: 'KI Analyse',       icon: <Bot size={14} />,             primary: true },
  { id: 'report',       label: 'Report',            icon: <ClipboardList size={14} />,   primary: true },
  { id: 'notes',        label: 'Notes',             icon: <FileText size={14} />,        primary: true },
  // Erreichbar über Subnavigation (nicht in Top-Nav):
  { id: 'iocs',         label: 'IoCs & Decision',  icon: <AlertTriangle size={14} /> },
  { id: 'export',       label: 'Evidence Export',  icon: <Download size={14} /> },
  { id: 'history',      label: 'History',          icon: <History size={14} /> },
  { id: 'playbooks',    label: 'Playbooks',        icon: <BookOpen size={14} /> },
];

/** Horizontale Analysis-Navigation — ALLE Unterseiten in einer Zeile (scrollbar),
 *  Icon + Label, aktiver Tab mit blauer Underline. Ersetzt die linke Subnav. */
export function AnalysisTopNav({ active, onSelect }: {
  active: DeckSection;
  onSelect: (s: DeckSection) => void;
}) {
  return (
    <nav aria-label="Analysis-Bereiche" style={{ display: 'flex', gap: 2, overflowX: 'auto', minWidth: 0, flex: 1 }}>
      {DECK_NAV_ITEMS.map((it) => {
        const on = active === it.id;
        return (
          <button key={it.id} onClick={() => onSelect(it.id)} title={it.label} aria-current={on ? 'page' : undefined} style={{
            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', padding: '10px 11px', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: on ? 700 : 600, background: 'transparent',
            borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent',
            color: on ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {it.icon}{it.label}
          </button>
        );
      })}
    </nav>
  );
}

export function AnalysisSubNav({ active, onSelect, counts }: {
  active: DeckSection;
  onSelect: (s: DeckSection) => void;
  counts?: Partial<Record<DeckSection, number>>;
}) {
  return (
    <Card style={{ padding: '8px 6px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 10px 8px' }}>
        Ticket-Bereiche
      </div>
      {DECK_NAV_ITEMS.map((it) => {
        const on = active === it.id;
        const count = counts?.[it.id];
        return (
          <button key={it.id} onClick={() => onSelect(it.id)} style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
            padding: '7px 10px', marginBottom: 1, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            border: 'none', fontSize: 12.5, fontWeight: on ? 700 : 500,
            background: on ? 'var(--accent-soft)' : 'transparent',
            color: on ? 'var(--accent)' : 'var(--text-muted)',
            borderLeft: on ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
            {it.icon}
            <span style={{ flex: 1 }}>{it.label}</span>
            {typeof count === 'number' && count > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? 'var(--accent)' : 'var(--text-dim)' }}>{count}</span>
            )}
          </button>
        );
      })}
    </Card>
  );
}
