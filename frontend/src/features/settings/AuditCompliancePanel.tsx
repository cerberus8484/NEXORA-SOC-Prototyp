/**
 * AuditCompliancePanel — „Audit & Compliance"-Tab in den Settings.
 *
 * Ehrlichkeits-Regel (ADR-009 analog):
 *   ECHT:     Audit-Aktivität aus /v1/audit (recent), Zähler je Action-Typ,
 *             letzte Ereignisse, Link zum vollständigen Audit-Log.
 *   EHRLICH:  Aufbewahrungshinweise (append-only, Cron, IP gehasht) — informativ, keine UI-Steuerung.
 *   GEPLANT:  Compliance-Report-Export — kein Backend → disabled angezeigt.
 *   NIEMALS:  Fake-Zertifizierung, "DSGVO-konform"-Behauptung, erfundene Standards.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Shield, FileText, Clock, AlertCircle, ChevronRight, Info, Lock } from 'lucide-react';
import { Card, CardHeader, CardBody, Spinner, EmptyState } from '../../components/ui';
import { auditApi, type AuditEntry } from '../audit/auditApi';
import { countByAction, actionLabel, recentWindowLabel } from './auditComplianceHelpers';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

const RECENT_LIMIT = 25;

// ── Haupt-Export ──────────────────────────────────────────────────────────────

export function AuditCompliancePanel() {
  const { t: tr } = useTranslation();
  const [entries, setEntries]   = useState<AuditEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    auditApi.recent(RECENT_LIMIT, { signal: ctrl.signal })
      .then((res) => {
        if (alive) setEntries(res.data ?? []);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : i18n.t('settings.auditDataCouldNotLoaded'));
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  if (loading) return <Spinner label={tr('settings.loadingAuditData')} />;

  if (error) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<AlertCircle size={28} />}
            title={tr('common.failedLoad')}
            message={error}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div style={s.root}>
      {/* Reihe 1: Aktivitäts-Übersicht + letzte Ereignisse */}
      <div style={s.row2}>
        <ActivitySummaryCard entries={entries} />
        <RecentEventsCard entries={entries} />
      </div>

      {/* Reihe 2: Aufbewahrungshinweise + Compliance-Standards + Geplantes */}
      <div style={s.row3}>
        <RetentionInfoCard />
        <ComplianceHintsCard />
        <PlannedReportCard />
      </div>
    </div>
  );
}

// ── Aktivitäts-Übersicht ──────────────────────────────────────────────────────

function ActivitySummaryCard({ entries }: { entries: AuditEntry[] }) {
  const { t: tr } = useTranslation();
  const counts = countByAction(entries);
  const total  = entries.length;
  const topActions = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <Card>
      <CardHeader
        title={tr('settings.auditActivity')}
        actions={
          <span style={s.pill}>
            <Shield size={11} /> {recentWindowLabel(RECENT_LIMIT)}
          </span>
        }
      />
      <CardBody>
        {total === 0 ? (
          <EmptyState
            icon={<Shield size={24} />}
            title={tr('settings.noAuditEntries')}
            message={tr('settings.noAuditEventsHaveBeen')}
          />
        ) : (
          <>
            <div style={s.totalRow}>
              <span style={s.totalValue}>{total}</span>
              <span style={s.totalLabel}>{tr('audit.eventsLoaded')}</span>
            </div>
            <div style={s.actionGrid}>
              {topActions.map(([action, count]) => (
                <div key={action} style={s.actionCell}>
                  <div style={s.actionCount}>{count}</div>
                  <div style={s.actionLabel}>{actionLabel(action)}</div>
                </div>
              ))}
            </div>
            <div style={s.hint}>
              <Info size={11} style={{ flexShrink: 0 }} />
              Echtdaten aus dem Audit-Log — Zähler beziehen sich auf die {RECENT_LIMIT} neuesten Einträge.
            </div>
            <a href="/audit" style={s.auditLink}>{tr('audit.toFullLog')}<ChevronRight size={12} />
            </a>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ── Letzte Ereignisse ─────────────────────────────────────────────────────────

function RecentEventsCard({ entries }: { entries: AuditEntry[] }) {
  const { t: tr } = useTranslation();
  const recent = entries.slice(0, 8);

  return (
    <Card>
      <CardHeader title={tr('audit.latestEvents')} />
      <CardBody>
        {recent.length === 0 ? (
          <EmptyState icon={<Clock size={24} />} title={tr('text.noEvents')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map((entry) => (
              <div key={entry.id} style={s.eventRow}>
                <div style={s.eventAction}>{actionLabel(entry.action)}</div>
                <div style={s.eventMeta}>
                  <span style={s.eventActor}>{entry.actorLabel || '—'}</span>
                  <span style={s.eventTime}>{formatRelative(entry.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Aufbewahrungshinweise ─────────────────────────────────────────────────────

function RetentionInfoCard() {
  const { t: tr } = useTranslation();
  const items = [
    {
      label:  'Audit-Log',
      status: 'echt' as const,
      detail: tr('settings.appendOnlyEntriesCannotOverwritten'),
    },
    {
      label:  'IP-Adressen',
      status: 'echt' as const,
      detail: tr('settings.ipAddressesStoredSha256'),
    },
    {
      label:  'DB-Backup',
      status: 'echt' as const,
      detail: tr('settings.dailyBackup0330Via'),
    },
    {
      label:  'Ticket-Retention',
      status: 'geplant' as const,
      detail: tr('text.noAutomaticCleanupControlThrough'),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={tr('settings.retention')}
        actions={<span style={s.pill}><Clock size={11} /> Server-Cron</span>}
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={s.hint}>
            <Info size={11} style={{ flexShrink: 0 }} />{tr('settings.retentionByCron')}</div>
          {items.map(({ label, status, detail }) => (
            <div key={label} style={s.retentionRow}>
              <div style={s.retentionHeader}>
                <span style={s.retentionLabel}>{label}</span>
                <span style={status === 'echt' ? s.badgeReal : s.badgePlanned}>
                  {status === 'echt' ? tr('common.active') : tr('common.planned')}
                </span>
              </div>
              <div style={s.retentionDetail}>{detail}</div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Compliance-Hinweise (informativ) ─────────────────────────────────────────

function ComplianceHintsCard() {
  const { t: tr } = useTranslation();
  const hints = [
    {
      title:  tr('settings.gdprArt32'),
      detail: tr('settings.systemImplementsTechnicalBuildingBlocks'),
    },
    {
      title:  'Audit-Trail',
      detail: tr('settings.allSecurityRelevantActionsLogin'),
    },
    {
      title:  'Zugriffsschutz',
      detail: tr('settings.auditEntriesRetrievableThroughApi'),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={tr('settings.complianceNotes')}
        actions={<span style={s.pill}><Lock size={11} /> {tr('settings.orientation')}</span>}
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={s.hint}>
            <Info size={11} style={{ flexShrink: 0 }} />{tr('settings.informativeOnly')}</div>
          {hints.map(({ title, detail }) => (
            <div key={title} style={s.retentionRow}>
              <div style={s.retentionHeader}>
                <span style={s.retentionLabel}>{title}</span>
              </div>
              <div style={s.retentionDetail}>{detail}</div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Geplanter Compliance-Report (ehrlich disabled) ────────────────────────────

function PlannedReportCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader
        title="Compliance-Report"
        actions={<span style={s.pill}><FileText size={11} /> {tr('common.planned')}</span>}
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={s.hint}>
            <Info size={11} style={{ flexShrink: 0 }} />{tr('settings.noComplianceBackend')}</div>
          {[
            { label: tr('settings.exportAuditReport'),     detail: tr('settings.pdfCsvExportAllAudit') },
            { label: tr('settings.complianceSummary'),   detail: tr('settings.autoReportPlanned') },
            { label: tr('settings.regulatoryReport'),      detail: tr('settings.reportTemplatesPlanned') },
          ].map(({ label, detail }) => (
            <div key={label} style={s.retentionRow}>
              <div style={s.retentionHeader}>
                <span style={s.retentionLabel}>{label}</span>
                <span style={s.badgePlanned}>{tr('common.planned')}</span>
              </div>
              <div style={s.retentionDetail}>{detail}</div>
            </div>
          ))}
          <button style={s.disabledBtn} disabled aria-disabled="true" type="button">{tr('settings.exportReportUnavailable')}</button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Hilfsfunktion (lokal, nicht exportiert) ───────────────────────────────────

function formatRelative(iso: string): string {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)   return 'Jetzt';
    if (mins < 60)  return i18n.t('time.minutesAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return i18n.t('time.hoursAgo', { count: hrs });
    const days = Math.floor(hrs / 24);
    return days === 1 ? i18n.t('time.oneDayAgo') : i18n.t('time.daysAgo', { count: days });
  } catch {
    return '—';
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: {
    display:       'flex',
    flexDirection: 'column',
    gap:           16,
  },
  row2: {
    display:             'grid',
    gridTemplateColumns: '1fr 1fr',
    gap:                 16,
    alignItems:          'start',
  },
  row3: {
    display:             'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap:                 16,
    alignItems:          'start',
  },
  totalRow: {
    display:       'flex',
    alignItems:    'baseline',
    gap:           8,
    marginBottom:  12,
  },
  totalValue: {
    fontSize:   28,
    fontWeight: 700,
    color:      'var(--text)',
    lineHeight: 1,
  },
  totalLabel: {
    fontSize: 12,
    color:    'var(--text-dim)',
  },
  actionGrid: {
    display:             'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap:                 8,
    marginBottom:        12,
  },
  actionCell: {
    background:   'var(--bg-card-soft)',
    border:       '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding:      '8px 6px',
    textAlign:    'center',
  },
  actionCount: {
    fontSize:     16,
    fontWeight:   700,
    color:        'var(--text)',
    marginBottom: 2,
  },
  actionLabel: {
    fontSize:  10,
    color:     'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    lineHeight: 1.3,
  },
  hint: {
    display:    'flex',
    alignItems: 'flex-start',
    gap:        5,
    fontSize:   11,
    color:      'var(--text-dim)',
    lineHeight: 1.5,
    marginTop:  4,
  },
  pill: {
    display:      'inline-flex',
    alignItems:   'center',
    gap:          4,
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 10,
    background:   'var(--bg-card-soft)',
    color:        'var(--text-dim)',
    border:       '1px solid var(--border-soft)',
  },
  auditLink: {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            4,
    marginTop:      10,
    fontSize:       12,
    color:          'var(--accent)',
    textDecoration: 'none',
  },
  eventRow: {
    padding:      '7px 10px',
    background:   'var(--bg-card-soft)',
    border:       '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
  },
  eventAction: {
    fontSize:     12,
    fontWeight:   600,
    color:        'var(--text)',
    marginBottom: 2,
  },
  eventMeta: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    gap:            8,
  },
  eventActor: {
    fontSize: 11,
    color:    'var(--text-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth:   '60%',
  },
  eventTime: {
    fontSize:   10,
    color:      'var(--text-muted)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  retentionRow: {
    padding:      '8px 10px',
    background:   'var(--bg-card-soft)',
    border:       '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
  },
  retentionHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   3,
  },
  retentionLabel: {
    fontSize:   12,
    fontWeight: 600,
    color:      'var(--text)',
  },
  retentionDetail: {
    fontSize:   11,
    color:      'var(--text-dim)',
    lineHeight: 1.5,
  },
  badgeReal: {
    fontSize:     10,
    padding:      '1px 7px',
    borderRadius: 10,
    background:   'color-mix(in srgb, var(--success) 15%, transparent)',
    color:        'var(--success)',
    border:       '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
    whiteSpace:   'nowrap',
  },
  badgePlanned: {
    fontSize:     10,
    padding:      '1px 7px',
    borderRadius: 10,
    background:   'color-mix(in srgb, var(--text-dim) 10%, transparent)',
    color:        'var(--text-dim)',
    border:       '1px solid var(--border-soft)',
    whiteSpace:   'nowrap',
  },
  disabledBtn: {
    marginTop:    8,
    padding:      '8px 14px',
    borderRadius: 'var(--radius-sm)',
    border:       '1px solid var(--border-soft)',
    background:   'var(--bg-input)',
    color:        'var(--text-muted)',
    fontSize:     12,
    cursor:       'not-allowed',
    opacity:      0.6,
    width:        '100%',
    textAlign:    'center',
  },
};
