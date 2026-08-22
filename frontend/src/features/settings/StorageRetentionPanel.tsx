/**
 * StorageRetentionPanel — „Speicherung & Retention"-Tab in den Settings.
 *
 * ADR-009 Ehrlichkeits-Regel:
 *   ECHT: DB-Größe, Tabellen-Aufschlüsselung, Datensatz-Zahlen, Schreibaktivität.
 *   EHRLICH GEPLANT: Tickets/Evidence/Hunts-Retention, Object-Storage / S3 / Archivierung.
 *   NIEMALS: Fake-50-TB-Donut, S3-Buckets, Glacier-Tabelle, Speicherklassen-Fiktion.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Database, HardDrive, BarChart2, Archive, Clock, Info } from 'lucide-react';
import { Card, CardHeader, CardBody, Spinner, EmptyState } from '../../components/ui';
import { systemApi, type SystemStats } from '../system/systemApi';
import { formatBytes, tableLabel, tableShare, totalRecords } from './storageRetentionHelpers';

// ── Haupt-Export ──────────────────────────────────────────────────────────────

export function StorageRetentionPanel() {
  const [stats, setStats]   = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    systemApi.stats()
      .then((res) => { if (alive) setStats(res.data); })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Daten konnten nicht geladen werden.');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <Spinner />;

  if (error) {
    return (
      <Card>
        <CardBody>
          <EmptyState icon={<Database size={28} />} title="Fehler beim Laden" message={error} />
        </CardBody>
      </Card>
    );
  }

  if (!stats) return null;

  if (!stats.dbEnabled) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Database size={28} />}
            title="Datenbank nicht verbunden"
            message="Speicherinformationen sind nur verfügbar, wenn eine PostgreSQL-Datenbank angebunden ist (DB_ENABLED=true)."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div style={s.root}>
      {/* Reihe 1: Übersicht + Tabellen-Aufschlüsselung */}
      <div style={s.row2}>
        <StorageOverviewCard stats={stats} />
        <TableBreakdownCard stats={stats} />
      </div>

      {/* Reihe 2: Schreibaktivität + Aufbewahrung + Object-Storage-Hinweis */}
      <div style={s.row3}>
        <ActivityCard stats={stats} />
        <RetentionInfoCard />
        <PlannedStorageCard />
      </div>
    </div>
  );
}

// ── Speicherübersicht ─────────────────────────────────────────────────────────

function StorageOverviewCard({ stats }: { stats: SystemStats }) {
  const dbBytes    = stats.storage?.dbBytes ?? 0;
  const tableCount = stats.storage?.tables?.length ?? 0;
  const records    = totalRecords(stats.counts);

  const items: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'PostgreSQL-Datenbankgröße',
      value: formatBytes(dbBytes),
      sub:   'Gesamtgröße der DB auf Disk',
    },
    {
      label: 'Tabellen',
      value: String(tableCount),
      sub:   'Datenbankiabellen gesamt',
    },
    {
      label: 'Datensätze gesamt',
      value: records.toLocaleString('de-DE'),
      sub:   'Summe aller Einträge',
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Speicherübersicht"
        actions={
          <span style={s.pill}>
            <Database size={11} /> PostgreSQL
          </span>
        }
      />
      <CardBody>
        <div style={s.statGrid}>
          {items.map(({ label, value, sub }) => (
            <div key={label} style={s.statCell}>
              <div style={s.statValue}>{value}</div>
              <div style={s.statLabel}>{label}</div>
              <div style={s.statSub}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={s.hint}>
          <Info size={11} style={{ flexShrink: 0 }} />
          Echte Größe der PostgreSQL-Datenbank — kein geschätzter oder hochgerechneter Wert.
        </div>
      </CardBody>
    </Card>
  );
}

// ── Tabellen-Aufschlüsselung ──────────────────────────────────────────────────

function TableBreakdownCard({ stats }: { stats: SystemStats }) {
  const tables  = stats.storage?.tables ?? [];
  const total   = stats.storage?.dbBytes ?? 0;

  if (tables.length === 0) {
    return (
      <Card>
        <CardHeader title="Speichernutzung pro Tabelle" />
        <CardBody>
          <EmptyState icon={<HardDrive size={24} />} title="Keine Tabellendaten" message="Noch keine Aufschlüsselung verfügbar." />
        </CardBody>
      </Card>
    );
  }

  const sorted = [...tables].sort((a, b) => b.bytes - a.bytes);

  return (
    <Card>
      <CardHeader title="Speichernutzung pro Tabelle" />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((t) => {
            const share = tableShare(t.bytes, total);
            return (
              <div key={t.name}>
                <div style={s.tableRow}>
                  <span style={s.tableName}>{tableLabel(t.name)}</span>
                  <span style={s.tableBytes}>{formatBytes(t.bytes)}</span>
                  <span style={s.tablePercent}>{share}%</span>
                </div>
                <div style={s.barTrack}>
                  <div style={{ ...s.barFill, width: `${share}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Schreibaktivität ──────────────────────────────────────────────────────────

function ActivityCard({ stats }: { stats: SystemStats }) {
  const activity = stats.activity ?? [];

  const maxWrites = activity.reduce((m, d) => Math.max(m, d.writes), 0);

  return (
    <Card>
      <CardHeader
        title="Schreibaktivität"
        actions={<span style={s.pill}><BarChart2 size={11} /> Writes / Tag</span>}
      />
      <CardBody>
        {activity.length === 0 ? (
          <EmptyState icon={<BarChart2 size={24} />} title="Keine Aktivitätsdaten" message="Noch keine Schreibaktivität verfügbar." />
        ) : (
          <div>
            <div style={s.activityChart}>
              {activity.map((d) => {
                const heightPct = maxWrites > 0 ? Math.max(2, Math.round((d.writes / maxWrites) * 100)) : 0;
                return (
                  <div key={d.day} style={s.activityBarWrap} title={`${d.day}: ${d.writes} Schreibvorgänge`}>
                    <div style={{ ...s.activityBar, height: `${heightPct}%` }} />
                    <div style={s.activityDay}>{d.day.slice(5)}</div>
                  </div>
                );
              })}
            </div>
            <div style={s.hint}>
              <Info size={11} style={{ flexShrink: 0 }} />
              Schreibvorgänge pro Tag (DB-Transaktionen) — kein Speicher-Wachstum.
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Aufbewahrung & Backup (ehrlich) ──────────────────────────────────────────

function RetentionInfoCard() {
  const items = [
    {
      label:  'Audit-Log-Bereinigung',
      status: 'echt',
      detail: 'Cron 02:00 — deploy/prune-audit-log.sh (Einträge > 90 Tage)',
    },
    {
      label:  'DB-Backup',
      status: 'echt',
      detail: 'Cron 03:30 — deploy/backup-db.sh (täglich, ~/backups/soc)',
    },
    {
      label:  'Ticket-Retention',
      status: 'geplant',
      detail: 'Keine automatische Bereinigung — Steuerung per UI geplant',
    },
    {
      label:  'Evidence-Retention',
      status: 'geplant',
      detail: 'Keine automatische Bereinigung — geplant',
    },
    {
      label:  'Hunt-Session-Retention',
      status: 'geplant',
      detail: 'Keine automatische Bereinigung — geplant',
    },
  ] as const;

  return (
    <Card>
      <CardHeader
        title="Aufbewahrung & Backup"
        actions={<span style={s.pill}><Clock size={11} /> Server-Cron</span>}
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={s.hint}>
            <Info size={11} style={{ flexShrink: 0 }} />
            Nur Cron-Jobs auf dem Server werden tatsächlich ausgeführt — keine UI-Steuerung.
          </div>
          {items.map(({ label, status, detail }) => (
            <div key={label} style={s.retentionRow}>
              <div style={s.retentionHeader}>
                <span style={s.retentionLabel}>{label}</span>
                <span style={status === 'echt' ? s.badgeReal : s.badgePlanned}>
                  {status === 'echt' ? 'Aktiv' : 'Geplant'}
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

// ── Object-Storage (ehrlich geplant) ─────────────────────────────────────────

function PlannedStorageCard() {
  return (
    <Card>
      <CardHeader
        title="Erweiterter Speicher"
        actions={<span style={s.pill}><Archive size={11} /> Geplant</span>}
      />
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={s.hint}>
            <Info size={11} style={{ flexShrink: 0 }} />
            Kein Object-Storage angebunden — das System nutzt ausschließlich PostgreSQL und lokalen Dateisystemspeicher.
          </div>
          {[
            { label: 'Object-Storage / S3',       detail: 'Nicht angebunden — geplant für eine spätere Phase' },
            { label: 'Archivierung / Glacier',     detail: 'Nicht angebunden — geplant für eine spätere Phase' },
            { label: 'Speicherklassen / Tiering',  detail: 'Kein Tiering — geplant für eine spätere Phase' },
          ].map(({ label, detail }) => (
            <div key={label} style={s.retentionRow}>
              <div style={s.retentionHeader}>
                <span style={s.retentionLabel}>{label}</span>
                <span style={s.badgePlanned}>Geplant</span>
              </div>
              <div style={s.retentionDetail}>{detail}</div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
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
  statGrid: {
    display:             'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap:                 12,
    marginBottom:        12,
  },
  statCell: {
    background:   'var(--bg-card-soft)',
    border:       '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding:      '10px 8px',
    textAlign:    'center',
  },
  statValue: {
    fontSize:   18,
    fontWeight: 700,
    color:      'var(--text)',
    marginBottom: 2,
  },
  statLabel: {
    fontSize:  10,
    color:     'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  statSub: {
    fontSize: 10,
    color:    'var(--text-muted)',
    marginTop: 2,
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
  tableRow: {
    display:        'flex',
    alignItems:     'center',
    gap:            8,
    marginBottom:   4,
  },
  tableName: {
    flex:      1,
    fontSize:  12,
    color:     'var(--text)',
  },
  tableBytes: {
    fontSize:  11,
    color:     'var(--text-dim)',
    whiteSpace: 'nowrap',
  },
  tablePercent: {
    fontSize:  11,
    color:     'var(--text-muted)',
    width:     32,
    textAlign: 'right',
  },
  barTrack: {
    height:       4,
    background:   'var(--bg-input)',
    borderRadius: 2,
    overflow:     'hidden',
    marginBottom: 4,
  },
  barFill: {
    height:       '100%',
    background:   'var(--accent)',
    borderRadius: 2,
    transition:   'width 0.3s ease',
    minWidth:     1,
  },
  activityChart: {
    display:        'flex',
    alignItems:     'flex-end',
    gap:            3,
    height:         80,
    marginBottom:   8,
    padding:        '0 2px',
  },
  activityBarWrap: {
    flex:           1,
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'flex-end',
    height:         '100%',
    cursor:         'default',
  },
  activityBar: {
    width:        '80%',
    background:   'var(--accent)',
    borderRadius: '2px 2px 0 0',
    transition:   'height 0.3s ease',
    minHeight:    1,
  },
  activityDay: {
    fontSize:  9,
    color:     'var(--text-muted)',
    marginTop: 2,
    whiteSpace: 'nowrap',
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
    marginBottom:   2,
  },
  retentionLabel: {
    fontSize:   12,
    fontWeight: 600,
    color:      'var(--text)',
  },
  retentionDetail: {
    fontSize:  11,
    color:     'var(--text-dim)',
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
};
