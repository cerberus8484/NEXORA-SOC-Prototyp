import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { HuntSession } from '../../lib/types';
import { Card, Input, Select, Button, EmptyState } from '../../components/ui';
import { badge } from '../../lib/badges';
import { filterSessions, SESSION_RANGE_OPTIONS } from './huntSessionFilter';

const TONE_VAR: Record<string, string> = {
  success: 'var(--success)', accent: 'var(--accent)', danger: 'var(--danger)',
  warning: 'var(--warning)', muted: 'var(--text-dim)', purple: 'var(--purple)',
};

function initials(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9]/g, '');
  return (cleaned.slice(0, 2) || '??').toUpperCase();
}

interface Props {
  sessions: HuntSession[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew?: () => void;
  canCreate?: boolean;
}

export function HuntSessionList({ sessions, activeId, onSelect, onNew, canCreate }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [analyst, setAnalyst] = useState('');
  const [range, setRange] = useState('');

  const analysts = [...new Set(sessions.map((s) => s.analystId))];
  const filtered = filterSessions(sessions, { q, status, analyst, range });

  const reset = () => { setQ(''); setStatus(''); setAnalyst(''); setRange(''); };

  return (
    <Card className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div className="row-between">
        <span className="card-title">Hunt Sessions</span>
        {canCreate && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={onNew}>Neue Session</Button>}
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-dim)' }} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sessions suchen …" style={{ paddingLeft: 32 }} />
      </div>
      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        options={[
          { value: '', label: 'Alle Status' },
          { value: 'planned', label: 'Geplant' }, { value: 'active', label: 'Aktiv' },
          { value: 'completed', label: 'Abgeschlossen' }, { value: 'failed', label: 'Fehlgeschlagen' },
          { value: 'cancelled', label: 'Abgebrochen' },
        ]}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1 }}>
        {filtered.length === 0 ? <EmptyState title="Keine Sessions" /> : filtered.map((s) => {
          const b = badge.sessionStatus(s.status);
          const isActive = activeId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{
                textAlign: 'left', cursor: 'pointer',
                background: isActive ? 'var(--accent-soft)' : 'var(--bg-card-soft)',
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-soft)'}`,
                borderRadius: 'var(--radius-sm)', padding: '11px 13px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: TONE_VAR[b.tone] }} />
                <span style={{ fontSize: 12, color: TONE_VAR[b.tone], fontWeight: 600 }}>{b.label}</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-dim)' }}>{s.id.slice(0, 8)}</span>
              </div>
              <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{s.targetHost}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.scope || 'kein Scope'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {new Date(s.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span style={{
                  marginLeft: 'auto', width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                  fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  display: 'grid', placeItems: 'center',
                }} title={`Analyst ${s.analystId}`}>
                  {initials(s.analystId)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter-Footer — Analyst + Zeitraum (client-seitig auf createdAt) */}
      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row-between">
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>Filter</span>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer' }}>Zurücksetzen</button>
        </div>
        <Select
          value={analyst}
          onChange={(e) => setAnalyst(e.target.value)}
          options={[{ value: '', label: 'Alle Analysten' }, ...analysts.map((a) => ({ value: a, label: `Analyst ${a.slice(0, 8)}` }))]}
        />
        <Select value={range} onChange={(e) => setRange(e.target.value)} options={SESSION_RANGE_OPTIONS} />
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{filtered.length} von {sessions.length} Sessions</div>
      </div>
    </Card>
  );
}
