// Linke Subnavigation des Hunt Decks — Unterseiten der aktiven Session.
import type { ReactNode } from 'react';
import {
  LayoutDashboard, TerminalSquare, ShieldAlert, Clock, Terminal,
  Crosshair, Archive, Ticket, GitPullRequest, Download,
} from 'lucide-react';

export type HuntSection =
  | 'overview' | 'console' | 'findings' | 'timeline' | 'commands'
  | 'targets' | 'evidence' | 'tickets' | 'response' | 'export';

const ITEMS: { id: HuntSection; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { id: 'console', label: 'Live Console', icon: <TerminalSquare size={14} /> },
  { id: 'findings', label: 'Findings', icon: <ShieldAlert size={14} /> },
  { id: 'timeline', label: 'Timeline', icon: <Clock size={14} /> },
  { id: 'commands', label: 'Commands', icon: <Terminal size={14} /> },
  { id: 'targets', label: 'Targets', icon: <Crosshair size={14} /> },
  { id: 'evidence', label: 'Evidence', icon: <Archive size={14} /> },
  { id: 'tickets', label: 'Tickets', icon: <Ticket size={14} /> },
  { id: 'response', label: 'Response', icon: <GitPullRequest size={14} /> },
  { id: 'export', label: 'Export', icon: <Download size={14} /> },
];

export function HuntSubNav({ active, onSelect, counts }: {
  active: HuntSection;
  onSelect: (s: HuntSection) => void;
  counts?: Partial<Record<HuntSection, number>>;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '12px 14px 6px', borderTop: '1px solid var(--border-soft)' }}>
        Hunt-Bereiche
      </div>
      <div style={{ padding: '0 8px 10px' }}>
        {ITEMS.map((it) => {
          const on = active === it.id;
          const count = counts?.[it.id];
          return (
            <button key={it.id} onClick={() => onSelect(it.id)} style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
              padding: '6px 10px', marginBottom: 1, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
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
      </div>
    </div>
  );
}
