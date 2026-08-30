import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Search, Package, AlertTriangle } from 'lucide-react';
import { hostsApi } from './hostsApi';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  initialPackagesState,
  startLoad,
  applyResponse,
  applyError,
  applySearch,
  nextQuery,
  hasMore,
  type HostPackagesState,
} from './hostPackagesModel';

// Installierte Software eines Hosts — wird ON DEMAND geladen: die Komponente
// mountet erst, wenn der Inventory-Tab offen ist (Conditional Rendering im
// HostDetail), nicht beim Mount der ganzen Seite.
// Server-seitige Suche (debounced) + Pagination ("mehr laden").
// Ehrliche Zustände: laden / Fehler (≠ leer) / leer / disabled (Wazuh nicht verbunden).

const SEARCH_DEBOUNCE_MS = 350;

const s: Record<string, CSSProperties> = {
  wrap:    { display: 'flex', flexDirection: 'column', gap: 10 },
  head:    { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  count:   { color: 'var(--text-dim)', fontWeight: 400 },
  searchBox: { position: 'relative' },
  searchIcon: { position: 'absolute', left: 10, top: 8, color: 'var(--text-dim)' },
  input:   { background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px 7px 30px', fontSize: 12.5, width: '100%' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:      { padding: '7px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' },
  td:      { padding: '6px 10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text)', verticalAlign: 'top' },
  tdVer:   { padding: '6px 10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' },
  tdVendor:{ padding: '6px 10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text-dim)' },
  hint:    { fontSize: 11.5, color: 'var(--text-dim)', padding: '6px 0' },
  errHint: { fontSize: 11.5, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' },
  more:    { alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};

interface Props {
  agentId: string;
}

export function HostPackagesTable({ agentId }: Props) {
  const { t: tr } = useTranslation();
  const [state, setState] = useState<HostPackagesState>(initialPackagesState);
  const [searchInput, setSearchInput] = useState('');
  // Aktiver Suchbegriff (debounced) — der gegen das Backend angewandt wird.
  const [activeSearch, setActiveSearch] = useState('');

  // Such-Eingabe debouncen, ohne bei jedem Tastendruck eine Anfrage zu feuern.
  useEffect(() => {
    const id = setTimeout(() => setActiveSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Erste Seite laden bzw. bei Agentenwechsel / neuer Suche neu laden.
  // Race-Schutz: nur die jeweils letzte Anfrage darf den State setzen.
  const reqRef = useRef(0);
  useEffect(() => {
    const reqId = ++reqRef.current;
    const base = applySearch(initialPackagesState(), activeSearch);
    setState(startLoad(base, true));
    const q = nextQuery(base);
    hostsApi.packages(agentId, q)
      .then((res) => {
        if (reqRef.current !== reqId) return;
        setState((prev) => applyResponse(prev, res, false));
      })
      .catch((err) => {
        if (reqRef.current !== reqId) return;
        setState((prev) => applyError(prev, err instanceof Error ? err.message : i18n.t('text.loadingFailed2')));
      });
    return () => { /* veraltete Anfrage wird über reqRef invalidiert */ };
  }, [agentId, activeSearch]);

  function loadMore() {
    const reqId = ++reqRef.current;
    setState((prev) => startLoad(prev, false));
    // Offset/Suche aus dem aktuellen State ableiten.
    setState((prev) => {
      const q = nextQuery(prev);
      hostsApi.packages(agentId, q)
        .then((res) => {
          if (reqRef.current !== reqId) return;
          setState((cur) => applyResponse(cur, res, true));
        })
        .catch((err) => {
          if (reqRef.current !== reqId) return;
          setState((cur) => applyError(cur, err instanceof Error ? err.message : tr('text.loadingFailed2')));
        });
      return prev;
    });
  }

  const { phase, items, total, error } = state;
  const showTable = items.length > 0;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <Package size={14} /> Installierte Software
        {phase === 'loaded' && <span style={s.count}>({total.toLocaleString('de-DE')} Pakete)</span>}
      </div>

      <div style={s.searchBox}>
        <Search size={13} style={s.searchIcon} />
        <input
          style={s.input}
          placeholder={tr('hosts.searchSoftwarePlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label={tr('hosts.searchInstalledSoftware')}
        />
      </div>

      {phase === 'disabled' && (
        <div style={s.hint}>{tr('hosts.wazuhNotConnected')}</div>
      )}

      {phase === 'error' && (
        <div style={s.errHint}><AlertTriangle size={13} /> {error}</div>
      )}

      {phase === 'loading' && items.length === 0 && (
        <div style={s.hint}>{tr('app.loadingSoftware')}</div>
      )}

      {phase === 'loaded' && items.length === 0 && (
        <div style={s.hint}>
          {activeSearch
            ? tr('hosts.noPackagesFor', { term: activeSearch })
            : tr('app.noInstalledSoftwareReportedHost')}
        </div>
      )}

      {showTable && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Version</th>
                <th style={s.th}>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={`${p.name}@${p.version}@${p.architecture}`}>
                  <td style={s.td}>{p.name || '—'}</td>
                  <td style={s.tdVer}>{p.version || '—'}</td>
                  <td style={s.tdVendor}>{p.vendor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore(state) && (
        <button type="button" style={s.more} onClick={loadMore}>
          Mehr laden ({items.length.toLocaleString('de-DE')} / {total.toLocaleString('de-DE')})
        </button>
      )}
      {phase === 'loading' && items.length > 0 && (
        <div style={s.hint}>{tr('app.loadingMorePackages')}</div>
      )}
    </div>
  );
}
