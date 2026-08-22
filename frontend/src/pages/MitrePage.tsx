import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { SectionHeader, Spinner, ErrorCard, Badge } from '../components/ui';
import { detectionApi } from '../features/detections/detectionApi';
import { huntApi } from '../features/hunts/huntApi';
import { MITRE_MATRIX, buildCombinedCoverageSet } from '../features/detections/mitreModel';

const s: Record<string, CSSProperties> = {
  page:    { padding: '24px 28px', maxWidth: 1600 },
  summary: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  kpi:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '14px 20px', minWidth: 140 },
  kpiVal:  { fontSize: 28, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 },
  kpiLbl:  { fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  tactic:  { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '12px 14px' },
  tacHdr:  { fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  tacId:   { fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 },
  row:     { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 },
  covTxt:  { color: 'var(--accent)', fontWeight: 600 },
  uncTxt:  { color: 'var(--text-dim)' },
  techId:  { fontFamily: 'var(--font-mono)', fontSize: 10.5, minWidth: 52 },
  bar:     { height: 4, borderRadius: 2, background: 'var(--bg-input)', marginTop: 8, overflow: 'hidden' },
  legend:  { display: 'flex', gap: 16, marginBottom: 20, fontSize: 12, color: 'var(--text-dim)', alignItems: 'center' },
};

const fillStyle = (pct: number): CSSProperties => ({
  height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width .4s ease',
});

export function MitrePage() {
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [enabled, setEnabled]   = useState(true);
  const [covered, setCovered]   = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    // Regeln UND Hunt-Katalog parallel laden — Coverage = Vereinigung beider Quellen.
    // Der Hunt-Katalog trägt auch dann bei, wenn Wazuh offline ist (Regeln leer).
    Promise.allSettled([detectionApi.list({ limit: 500 }), huntApi.catalog()])
      .then(([rulesRes, huntsRes]) => {
        if (!alive) return;
        if (rulesRes.status === 'rejected' && huntsRes.status === 'rejected') {
          const e = rulesRes.reason;
          setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
          return;
        }
        const rules = rulesRes.status === 'fulfilled' ? rulesRes.value : null;
        const hunts = huntsRes.status === 'fulfilled' ? huntsRes.value.data ?? [] : [];
        setEnabled(rules?.enabled ?? false);
        const ruleIds = (rules?.data ?? []).flatMap((rule) => rule.mitre);
        setCovered(buildCombinedCoverageSet(ruleIds, hunts));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    const total = MITRE_MATRIX.reduce((n, t) => n + t.techniques.length, 0);
    const covCount = MITRE_MATRIX.reduce(
      (n, t) => n + t.techniques.filter((x) => covered.has(x.id)).length, 0,
    );
    return { total, covCount, pct: total ? Math.round((covCount / total) * 100) : 0 };
  }, [covered]);

  if (loading) return <div style={s.page}><Spinner /></div>;
  if (error)   return <div style={s.page}><ErrorCard message={error} /></div>;

  return (
    <div style={s.page}>
      <SectionHeader
        title="MITRE ATT&CK Coverage"
        subtitle={enabled ? 'Abdeckung aus Wazuh-Rules + Hunt-Katalog gegen ein kuratiertes ATT&CK-Subset — nicht das vollständige Framework' : 'Wazuh nicht verbunden — Coverage aus dem Hunt-Katalog (Rules fehlen)'}
        onBack={() => navigate(-1)}
        help="mitre"
      />

      <div style={s.summary}>
        <div style={s.kpi}>
          <div style={s.kpiVal}>{stats.pct}%</div>
          <div style={s.kpiLbl}>Coverage</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: 'var(--success)' }}>{stats.covCount}</div>
          <div style={s.kpiLbl}>Abgedeckt</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: 'var(--text-dim)' }}>{stats.total - stats.covCount}</div>
          <div style={s.kpiLbl}>Lücken</div>
        </div>
        <div style={s.kpi}>
          <div style={s.kpiVal}>{MITRE_MATRIX.length}</div>
          <div style={s.kpiLbl}>Taktiken</div>
        </div>
      </div>

      <div style={s.legend}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <CheckCircle2 size={13} style={{ color: 'var(--accent)' }} /> Abgedeckt
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Circle size={13} style={{ color: 'var(--text-dim)' }} /> Keine Regel
        </span>
        {!enabled && <Badge tone="warning">Wazuh offline — live Coverage nicht verfügbar</Badge>}
      </div>

      <div style={s.grid}>
        {MITRE_MATRIX.map((tactic) => {
          const tacCov = tactic.techniques.filter((t) => covered.has(t.id)).length;
          const tacPct = tactic.techniques.length ? Math.round((tacCov / tactic.techniques.length) * 100) : 0;
          return (
            <div key={tactic.id} style={s.tactic}>
              <div style={s.tacHdr}>{tactic.name}</div>
              <div style={s.tacId}>{tactic.id} · {tacCov}/{tactic.techniques.length} ({tacPct}%)</div>
              <div style={s.bar}><div style={fillStyle(tacPct)} /></div>
              <div style={{ marginTop: 10 }}>
                {tactic.techniques.map((tech) => {
                  const isCovered = covered.has(tech.id);
                  return (
                    <div key={tech.id} style={s.row} title={isCovered ? `${tech.id} wird erkannt` : `${tech.id} — keine Regel`}>
                      {isCovered
                        ? <CheckCircle2 size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        : <Circle size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
                      <span style={{ ...s.techId, color: isCovered ? 'var(--accent)' : 'var(--text-dim)' }}>{tech.id}</span>
                      <span style={isCovered ? s.covTxt : s.uncTxt}>{tech.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
