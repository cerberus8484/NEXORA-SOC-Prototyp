import { useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink } from 'lucide-react';
import { EmptyState, Spinner, ErrorCard } from '../../components/ui';
import { auditApi } from '../audit/auditApi';
import { formatUserAuditEntry, USER_AUDIT_ACTIONS } from './userAuditFormat';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg-card, #141824)',
    border: '1px solid var(--border, rgba(255,255,255,0.08))',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 180,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
  },
  feedLink: {
    fontSize: 11,
    color: 'var(--accent)',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflowY: 'auto',
    maxHeight: 260,
  },
  row: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--bg-card-soft)',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  desc: {
    fontSize: 12.5,
    color: 'var(--text)',
    lineHeight: 1.4,
  },
  meta: {
    fontSize: 11,
    color: 'var(--text-dim)',
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
};

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return i18n.t('time.justNow');
    if (minutes < 60) return i18n.t('time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return i18n.t('time.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return days === 1 ? i18n.t('time.oneDayAgo') : i18n.t('time.daysAgo', { count: days });
  } catch {
    return iso;
  }
}

/** Zeigt die letzten Benutzer-/Rollen-Events aus dem Audit-Log. */
export function UserAuditFeed() {
  const { t: tr } = useTranslation();
  const [entries, setEntries] = useState<ReturnType<typeof formatUserAuditEntry>[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const abortRef                = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');

    auditApi
      .list(
        { targetType: 'user', limit: 20 },
        { signal: controller.signal },
      )
      .then((res) => {
        if (controller.signal.aborted) return;
        // Filter auf die 4 bekannten User-Aktionen; ältere/andere ignorieren
        const known = new Set<string>(USER_AUDIT_ACTIONS);
        const formatted = (res.data ?? [])
          .filter((e) => known.has(e.action))
          .map(formatUserAuditEntry);
        setEntries(formatted);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : i18n.t('ui.auditFeedCouldNotLoaded'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <div style={s.card}>
      <div style={s.header}>
        <span style={s.title}>
          <Activity size={14} />{tr('audit.activity')}</span>
        <a href="/audit" style={s.feedLink}>{tr('common.showAll')}<ExternalLink size={11} />
        </a>
      </div>

      {loading && <Spinner />}
      {!loading && error && <ErrorCard message={error} />}
      {!loading && !error && entries.length === 0 && (
        <EmptyState title={tr('text.noUserEvents')} message={tr('ui.noRoleAccountChangesHave')} />
      )}
      {!loading && !error && entries.length > 0 && (
        <ul style={{ ...s.list, listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li key={`${e.createdAt}-${e.description}`} style={s.row}>
              <span style={s.desc}>{e.description}</span>
              <span style={s.meta}>
                <span>Durch: {e.actorLabel}</span>
                <span>{formatRelativeTime(e.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
