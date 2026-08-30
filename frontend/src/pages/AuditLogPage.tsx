import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Search, FilterX, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { auditApi, type AuditEntry } from '../features/audit/auditApi';
import { auditEntriesToCsv, auditCsvFilename } from '../features/audit/auditExport';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { SectionHeader, Card, Badge, Input, Select, EmptyState, Spinner, ErrorCard, Button, type Tone } from '../components/ui';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// Einträge pro Seite — bewusst kleiner als 200 (Compliance: kein stilles Truncate)
const PAGE_SIZE = 50;

const auditActions = () => [
  { value: '', label: i18n.t('label.allActions') },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'LOGIN_FAILED', label: i18n.t('login.failed') },
  { value: 'TICKET_CREATE', label: i18n.t('audit.ticketCreated') },
  { value: 'TICKET_UPDATE', label: i18n.t('audit.ticketUpdated') },
  { value: 'TICKET_DELETE', label: i18n.t('settings.ticketDeleted') },
  { value: 'TICKET_VIEW', label: 'Ticket angesehen' },
  { value: 'AGENT_SUGGESTION_APPROVE', label: i18n.t('audit.aiSuggestionApproved') },
  { value: 'AGENT_SUGGESTION_REJECT', label: i18n.t('audit.aiSuggestionRejected') },
  { value: 'USER_ROLE_CHANGE', label: i18n.t('app.roleChanged') },
  { value: 'USER_ACTIVE_CHANGE', label: i18n.t('audit.userActivationChanged') },
  { value: 'USER_CREATED', label: i18n.t('audit.userCreated') },
  { value: 'SETTINGS_CHANGED', label: i18n.t('app.settingsChanged') },
];

const targetTypes = () => [
  { value: '', label: i18n.t('label.allTargetTypes') },
  { value: 'ticket', label: 'Ticket' },
  { value: 'user', label: i18n.t('common.users') },
  { value: 'settings', label: i18n.t('app.settings') },
  { value: 'agent_suggestion', label: i18n.t('analysis.aiSuggestion') },
];

const ACTION_TONES: Record<string, Tone> = {
  LOGIN:                     'success',
  LOGOUT:                    'muted',
  LOGIN_FAILED:              'danger',
  TICKET_CREATE:             'accent',
  TICKET_UPDATE:             'accent',
  TICKET_DELETE:             'danger',
  TICKET_VIEW:               'muted',
  AGENT_SUGGESTION_APPROVE:  'success',
  AGENT_SUGGESTION_REJECT:   'warning',
  USER_ROLE_CHANGE:          'warning',
  USER_ACTIVE_CHANGE:        'warning',
  USER_CREATED:              'success',
  SETTINGS_CHANGED:          'warning',
};

const SEARCH_DEBOUNCE_MS = 300;

const s: Record<string, CSSProperties> = {
  filterBar: { padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  filterLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 },
  searchWrap: { position: 'relative', flex: '1 1 220px', maxWidth: 320, marginLeft: 8 },
  searchIcon: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' },
  resetBtn: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--radius-sm)' },
  mono: { fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
  actorCell: { fontSize: 13, color: 'var(--text)' },
  targetCell: { fontSize: 12, color: 'var(--text-dim)' },
  paginationBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border-soft)' },
  paginationInfo: { fontSize: 11, color: 'var(--text-dim)' },
  accessDenied: { padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function actionTone(action: string): Tone {
  return ACTION_TONES[action] ?? 'muted';
}

export function AuditLogPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();

  // RBAC-Guard: Audit-Log enthält IP-Hashes, Rollen, Aktionen — nicht für viewer.
  if (!can.act(user?.role)) {
    return (
      <div>
        <SectionHeader title="Audit-Log" />
        <Card>
          <div style={s.accessDenied}>{tr('audit.accessDeniedAnalyst')}</div>
        </Card>
      </div>
    );
  }

  return <AuditLogView />;
}

/** Innere Komponente — wird nur gerendert wenn RBAC passt. */
function AuditLogView() {
  const { t: tr } = useTranslation();
  const [entries, setEntries]           = useState<AuditEntry[] | null>(null);
  const [total, setTotal]               = useState<number | null>(null);
  const [error, setError]               = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [offset, setOffset]             = useState(0);
  const [exporting, setExporting]       = useState(false);
  const [exportNote, setExportNote]     = useState(''); // A6c: sichtbarer Hinweis bei gekürztem Export
  const [loading, setLoading]           = useState(false);
  const [hasNext, setHasNext]           = useState<boolean | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqId.current;
    setError('');
    setLoading(true);
    try {
      const res = await auditApi.list({
        limit:      PAGE_SIZE,
        offset,
        action:     actionFilter     || undefined,
        targetType: targetTypeFilter || undefined,
        search:     searchApplied     || undefined, // A6a: Suche serverseitig, über die GESAMTE Menge
      });
      if (myReq !== reqId.current) return;
      setEntries(res.data ?? []);
      // total/hasNext aus serverseitigem COUNT — exakt, kein "Weiter wenn volle Seite"-Heuristik mehr
      setTotal(typeof res.total === 'number' ? res.total : null);
      setHasNext(typeof res.hasNext === 'boolean' ? res.hasNext : null);
    } catch (err) {
      if (myReq !== reqId.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : i18n.t('app.failedLoadAuditLog'));
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }, [actionFilter, targetTypeFilter, offset, searchApplied]);

  useEffect(() => { void load(); }, [load]);

  // Filter- ODER Such-Änderungen: zurück auf Seite 1 (Suche wirkt serverseitig, nicht nur auf Seite 1)
  useEffect(() => { setOffset(0); setTotal(null); }, [actionFilter, targetTypeFilter, searchApplied]);

  // Suchbegriff debounced
  useEffect(() => {
    const t = setTimeout(() => setSearchApplied(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // A6a: Suche läuft serverseitig über die GESAMTE Menge — keine Client-Filterung mehr
  // (die hätte nur die geladene Seite durchsucht → forensisch falsche Negativ-Treffer).
  const visible = entries ?? [];

  const hasFilter = actionFilter !== '' || targetTypeFilter !== '' || searchInput !== '';
  const page      = Math.floor(offset / PAGE_SIZE) + 1;
  // hasNextPage: bevorzugt das serverseitige hasNext, sonst aus total, sonst volle-Seite-Heuristik.
  const hasNextPage = hasNext !== null
    ? hasNext
    : total !== null
      ? offset + PAGE_SIZE < total
      : (entries?.length ?? 0) >= PAGE_SIZE;

  function resetFilters() {
    setActionFilter('');
    setTargetTypeFilter('');
    setSearchInput('');
    setOffset(0);
  }

  // A6c: bewusster, serverseitig auditierter Export (Server-Filter + Suche, gedeckelt).
  // Liefert die Trunkierungs-Info mit → eine Kürzung wird sichtbar gemacht, nicht verschluckt.
  async function fetchExportRows(format: 'csv' | 'pdf'): Promise<{ rows: AuditEntry[]; truncated: boolean; total: number; exportLimit: number }> {
    const res = await auditApi.exportAudit({
      action:     actionFilter     || undefined,
      targetType: targetTypeFilter || undefined,
      search:     searchApplied     || undefined,
      format,
    });
    const rows = res.data ?? [];
    return { rows, truncated: Boolean(res.truncated), total: res.total ?? rows.length, exportLimit: res.exportLimit ?? rows.length };
  }

  function noteIfTruncated(truncated: boolean, total: number, exportLimit: number) {
    setExportNote(truncated
      ? tr('audit.exportTruncated', { limit: exportLimit, total })
      : '');
  }

  // PDF-Export — jsPDF dynamisch laden (Heavy-Lib aus dem Haupt-Bundle halten).
  async function handlePdfExport() {
    setExporting(true);
    setError('');
    setExportNote('');
    try {
      const { rows, truncated, total, exportLimit } = await fetchExportRows('pdf');
      const { buildAuditPdfDoc, auditPdfFilename } = await import('../features/audit/auditPdf');
      buildAuditPdfDoc(rows).save(auditPdfFilename());
      noteIfTruncated(truncated, total, exportLimit);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('common.pdfExportFailed'));
    } finally {
      setExporting(false);
    }
  }

  // CSV-Export (CSV-Injection-Schutz im Modul). BOM → Excel liest UTF-8 korrekt.
  async function handleExport() {
    setExporting(true);
    setError('');
    setExportNote('');
    try {
      const { rows, truncated, total, exportLimit } = await fetchExportRows('csv');
      // BOM voranstellen → Excel liest UTF-8 korrekt.
      const blob = new Blob(['﻿' + auditEntriesToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = auditCsvFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      noteIfTruncated(truncated, total, exportLimit);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('common.csvExportFailed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Audit-Log"
        help="audit"
        subtitle={loading
          ? tr('ui.loading')
          : entries !== null
            ? total !== null
              ? tr('audit.entriesTotalPage', { shown: visible.length, total, page })
              : tr('audit.entriesPage', { shown: visible.length, page })
            : undefined}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              disabled={exporting || !(entries && entries.length > 0)}
              onClick={() => void handleExport()}
              title={tr('app.exportFilteredAuditEntriesCsv')}
            >
              {exporting ? 'Export …' : 'CSV-Export'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              disabled={exporting || !(entries && entries.length > 0)}
              onClick={() => void handlePdfExport()}
              title={tr('app.exportFilteredAuditEntriesPdf')}
            >
              {exporting ? 'Export …' : 'PDF-Export'}
            </Button>
          </div>
        }
      />

      {exportNote && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--warning)', background: 'var(--warning-soft, rgba(245,158,11,0.12))', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{exportNote}</span>
          <button onClick={() => setExportNote('')} aria-label={tr('app.dismissNotice')} style={{ background: 'none', border: 'none', color: 'var(--warning)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>
      )}
      <Card style={s.filterBar}>
        <span style={s.filterLabel}>Aktion</span>
        <div style={{ minWidth: 210 }}>
          <Select options={auditActions()} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
        </div>

        <span style={s.filterLabel}>Zieltyp</span>
        <div style={{ minWidth: 160 }}>
          <Select options={targetTypes()} value={targetTypeFilter} onChange={(e) => setTargetTypeFilter(e.target.value)} />
        </div>

        <div style={s.searchWrap}>
          <Search size={14} style={s.searchIcon} />
          <Input
            type="search"
            aria-label={tr('audit.search')}
            placeholder={tr('audit.actorTargetPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>

        {hasFilter && (
          <button style={s.resetBtn} onClick={resetFilters}>
            <FilterX size={14} />{tr('common.resetFilters')}</button>
        )}
      </Card>

      <Card>
        {error ? (
          <ErrorCard message={error} />
        ) : entries === null ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState
            title={tr('app.noEntries')}
            message={hasFilter ? tr('app.noEntriesMatchFilter') : tr('app.auditLogEmpty')}
          />
        ) : (
          <>
            {/* A6a: während eines neuen Requests die alte Seite dimmen — nicht als „aktuell" zeigen. */}
            <table className="table" style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 120ms' }}>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Aktion</th>
                  <th>Akteur</th>
                  <th>{tr('common.target')}</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id}>
                    <td style={s.mono}>{formatDate(e.createdAt)}</td>
                    <td><Badge tone={actionTone(e.action)}>{e.action}</Badge></td>
                    <td style={s.actorCell}>{e.actorLabel || '—'}</td>
                    <td style={s.targetCell}>
                      {e.targetType ? (
                        <>
                          <span style={{ color: 'var(--text-muted)' }}>{e.targetType}</span>
                          {e.targetId && e.targetId !== '' && e.targetId !== 'undefined' && (
                            <span style={s.mono}> · {e.targetId}</span>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td style={s.mono}>{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={s.paginationBar}>
              <span style={s.paginationInfo}>
                {total !== null
                  ? tr('audit.rangeOfPage', { from: offset + 1, to: Math.min(offset + (entries?.length ?? 0), total), total, page })
                  : tr('audit.entriesPageShort', { shown: visible.length, page })}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ChevronLeft size={14} />}
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >{tr('common.back2')}</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ChevronRight size={14} />}
                  disabled={!hasNextPage}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Weiter
                </Button>
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
