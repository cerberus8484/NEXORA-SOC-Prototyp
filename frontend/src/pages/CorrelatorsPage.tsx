import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { GitMerge, ShieldOff, RefreshCw } from 'lucide-react';
import { Badge, Button, Spinner, ErrorCard, HelpTip } from '../components/ui';
import { correlatorsApi, type CorrelatorSummary, type RiskClass } from '../features/correlators/correlatorsApi';
import { riskTone, riskLabel, queueHeadline, canReadCorrelators } from '../features/correlators/correlatorsView';
import { CorrelatorDetailModal } from '../features/correlators/CorrelatorDetailModal';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

const s: Record<string, CSSProperties> = {
  page: { padding: '16px 20px' },
  head: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  panel: { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', marginBottom: 16 },
  panelHead: { padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  th: { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '8px 12px', borderBottom: '1px solid var(--border-soft)' },
  td: { fontSize: 12.5, padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' },
  select: { background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '5px 8px', fontSize: 12.5 },
};

const RISK_OPTIONS: (RiskClass | 'all')[] = ['all', 'low', 'medium', 'high'];

export function CorrelatorsPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  if (!canReadCorrelators(user?.role)) {
    return (
      <div style={{ ...s.page, paddingTop: 48, textAlign: 'center' }}>
        <ShieldOff size={40} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>{tr('common.accessDenied')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>{tr('common.analystPage')}</div>
      </div>
    );
  }
  return <CorrelatorsContent role={user?.role} />;
}

function CorrelatorsContent({ role }: { role: string | undefined }) {
  const { t: tr } = useTranslation();
  const [correlators, setCorrelators] = useState<CorrelatorSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskClass | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [detailId, setDetailId] = useState<string>('');

  async function load() {
    try {
      const res = await correlatorsApi.list();
      setCorrelators(res.data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : tr('text.loadingFailed2'));
    }
  }
  useEffect(() => { void load(); }, []);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const c of correlators ?? []) for (const src of c.inputSources) set.add(src);
    return ['all', ...[...set].sort()];
  }, [correlators]);

  const filtered = useMemo(() => (correlators ?? []).filter((c) => {
    if (riskFilter !== 'all' && c.riskClass !== riskFilter) return false;
    if (sourceFilter !== 'all' && !c.inputSources.includes(sourceFilter)) return false;
    if (activeOnly && c.queue.active === 0) return false;
    return true;
  }), [correlators, riskFilter, sourceFilter, activeOnly]);

  const detail = (correlators ?? []).find((c) => c.id === detailId) || null;

  if (loadError) return <div style={s.page}><ErrorCard message={loadError} /></div>;
  if (!correlators) return <div style={s.page}><Spinner /></div>;

  return (
    <div style={s.page}>
      <div style={s.head}>
        <GitMerge size={26} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            Correlation Operations Center <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>/ Registry</span>
            <HelpTip topic="correlation" />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{tr('correlators.subtitle')}</div>
        </div>
        <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()} title={tr('label.refresh')}>{tr('label.refresh')}</Button>
      </div>

      <div style={s.panel}>
        <div style={s.panelHead}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Correlatoren ({filtered.length})</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Risiko</label>
            <select aria-label="Risiko-Filter" style={s.select} value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as RiskClass | 'all')}>
              {RISK_OPTIONS.map((r) => <option key={r} value={r}>{r === 'all' ? tr('common.all') : riskLabel(r as RiskClass)}</option>)}
            </select>
            <label style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('common.source')}</label>
            <select aria-label={tr('collectors.sourceFilter')} style={s.select} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              {sources.map((src) => <option key={src} value={src}>{src === 'all' ? tr('common.all') : src}</option>)}
            </select>
            <label style={{ fontSize: 11.5, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> nur aktive
            </label>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Correlator', 'Engine', 'Inputs / Outputs', 'Risiko', tr('app.lastActivity'), 'Queue'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>{tr('correlators.noneForFilter')}</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(c.id)}>
                  <td style={{ ...s.td, fontWeight: 600, color: 'var(--accent)' }}>{c.name}</td>
                  <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.engineVersion}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {c.inputSources.map((i) => <Badge key={i} tone="muted">{i}</Badge>)}
                      <span style={{ color: 'var(--text-dim)' }}>→</span>
                      {c.outputTypes.map((o) => <Badge key={o} tone="accent">{o}</Badge>)}
                    </div>
                  </td>
                  <td style={s.td}><Badge tone={riskTone(c.riskClass)} dot>{riskLabel(c.riskClass)}</Badge></td>
                  <td style={s.td}>{c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString('de-DE') : '—'}</td>
                  <td style={{ ...s.td, color: 'var(--text-dim)', fontSize: 11.5 }}>{queueHeadline(c.queue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && <CorrelatorDetailModal correlator={detail} role={role} onClose={() => setDetailId('')} />}
    </div>
  );
}
