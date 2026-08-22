import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, Search, Zap, Filter } from 'lucide-react';
import { huntApi, type CreateHuntBody, type HuntCatalogItem } from '../features/hunts/huntApi';
import { launchHunt } from '../features/hunts/launchHunt';
import { SectionHeader, Badge, Button, Spinner, ErrorCard, type Tone } from '../components/ui';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';

const riskTone = (r: string): Tone =>
  r === 'critical' || r === 'high' ? 'danger' : r === 'medium' ? 'warning' : 'muted';

const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const CATEGORIES = ['Alle', 'Persistence', 'Lateral Movement', 'Execution', 'Network', 'Exfiltration', 'Defense Evasion'];
const RISKS = ['Alle', 'critical', 'high', 'medium', 'low'];

const s: Record<string, CSSProperties> = {
  filters:  { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 },
  search:   { flex: 1, minWidth: 200, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 12px', fontSize: 13 },
  chip:     { fontSize: 12, padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border-soft)', background: 'var(--bg-card-soft)', color: 'var(--text-muted)', cursor: 'pointer', transition: 'all .15s' },
  chipOn:   { borderColor: 'var(--accent)', background: 'var(--accent)', color: '#000' },
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
  card:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'border-color .2s, box-shadow .2s' },
  cardHead: { padding: '14px 16px 10px', borderBottom: '1px solid var(--border-soft)' },
  cardBody: { padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 },
  cardFoot: { padding: '10px 16px', borderTop: '1px solid var(--border-soft)', background: 'var(--bg-card-soft)' },
  label:    { fontSize: 10.5, textTransform: 'uppercase' as const, letterSpacing: 0.5, color: 'var(--text-dim)', marginBottom: 3 },
  input:    { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 12.5, boxSizing: 'border-box' as const },
  tags:     { display: 'flex', gap: 5, flexWrap: 'wrap' as const },
  empty:    { gridColumn: '1/-1', textAlign: 'center' as const, padding: 60, color: 'var(--text-dim)', fontSize: 14 },
};

export function HuntLibraryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canAct = can.act(user?.role);

  const [catalog, setCatalog] = useState<HuntCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Alle');
  const [riskFilter, setRiskFilter] = useState('Alle');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState('');
  const [launchError, setLaunchError] = useState('');

  useEffect(() => {
    huntApi.catalog()
      .then((r) => setCatalog(r.data ?? []))
      .catch(() => setError('Katalog konnte nicht geladen werden'))
      .finally(() => setLoading(false));
  }, []);

  function targetFor(item: HuntCatalogItem) {
    return targets[item.key] ?? item.defaultTarget;
  }

  function setTarget(key: string, val: string) {
    setTargets((prev) => ({ ...prev, [key]: val }));
  }

  async function launch(item: HuntCatalogItem) {
    const t = targetFor(item).trim();
    if (!t) return;
    setLaunching(item.key);
    setLaunchError('');
    try {
      const body: CreateHuntBody = {
        huntType: item.key,
        targetHost: t,
        targetType: item.targetType as CreateHuntBody['targetType'],
        riskLevel: item.riskLevel,
        sourceIp: item.defaultIp || undefined,
        scope: 'Hunt Library · Quick-Launch · Safe Collectors',
      };
      // A2-Fix: launchHunt legt die Session an UND startet sie wirklich (start() fehlte).
      const id = await launchHunt(huntApi, body);
      navigate(`/threat-hunts/${id}`);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : 'Start fehlgeschlagen');
    } finally {
      setLaunching('');
    }
  }

  const visible = catalog
    .filter((item) => {
      if (catFilter !== 'Alle' && item.category !== catFilter) return false;
      if (riskFilter !== 'Alle' && item.riskLevel !== riskFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.mitre.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => (riskOrder[a.riskLevel] ?? 9) - (riskOrder[b.riskLevel] ?? 9));

  const usedCategories = [...new Set(catalog.map((i) => i.category).filter(Boolean))];
  const categoryChips = ['Alle', ...CATEGORIES.filter((c) => c === 'Alle' || usedCategories.includes(c))];

  if (loading) return <Spinner />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div>
      <SectionHeader
        title="Hunt Library"
        subtitle={`${catalog.length} vorgefertigte Hunts — ein Klick startet`}
        help="hunts"
        actions={<Badge tone="accent"><Zap size={12} style={{ marginRight: 4 }} />Quick-Launch</Badge>}
      />

      {/* Filter-Leiste */}
      <div style={s.filters}>
        <div style={{ position: 'relative' as const, flex: 1, minWidth: 200 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }} />
          <input style={{ ...s.search, paddingLeft: 30 }} placeholder="Hunt suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <Filter size={13} style={{ color: 'var(--text-dim)' }} />
          {RISKS.map((r) => (
            <button key={r} style={{ ...s.chip, ...(riskFilter === r ? s.chipOn : {}) }} onClick={() => setRiskFilter(r)}>
              {r === 'Alle' ? 'Risk: alle' : r}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {categoryChips.map((c) => (
            <button key={c} style={{ ...s.chip, ...(catFilter === c ? s.chipOn : {}) }} onClick={() => setCatFilter(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {launchError && (
        <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--danger-soft, rgba(255,80,80,.1))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)' }}>
          {launchError}
        </div>
      )}

      {/* Karten-Grid */}
      <div style={s.grid}>
        {visible.length === 0 && (
          <div style={s.empty}>Keine Hunts gefunden — Filter anpassen.</div>
        )}
        {visible.map((item) => (
          <div key={item.key} style={s.card}>
            {/* Kopf */}
            <div style={s.cardHead}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <Crosshair size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1, lineHeight: 1.3 }}>{item.label}</span>
                <Badge tone={riskTone(item.riskLevel)}>{item.riskLevel}</Badge>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>{item.description}</p>
            </div>

            {/* Body: Tags */}
            <div style={s.cardBody}>
              <div style={s.tags}>
                {item.category && <Badge tone="muted">{item.category}</Badge>}
                {item.mitre && <Badge tone="accent">{item.mitre}</Badge>}
                {item.dataSources.map((ds) => <Badge key={ds} tone="muted">{ds}</Badge>)}
              </div>

              {/* Target-Input */}
              <div>
                <div style={s.label}>Target ({item.targetType})</div>
                <input
                  style={s.input}
                  value={targetFor(item)}
                  onChange={(e) => setTarget(item.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canAct) void launch(item); }}
                  placeholder={item.defaultTarget || 'Hostname / IP'}
                  disabled={!canAct}
                />
              </div>
            </div>

            {/* Footer: Start-Button */}
            <div style={s.cardFoot}>
              <Button
                variant="primary"
                size="sm"
                icon={<Zap size={13} />}
                disabled={!canAct || !!launching || !targetFor(item).trim()}
                onClick={() => void launch(item)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {launching === item.key ? 'Starte …' : 'Hunt starten'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
