// Letzte Sicherheitsereignisse — echt aus auditApi, gefiltert auf Security-Actions.
// ADR-009: Kein Fake-Datum, kein Fake-Wert. Link → /audit.
// "Letzte Passwortänderung" zeigt ehrlich "—" (kein per-user-tracking im Backend).

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, EmptyState, Spinner } from '../../components/ui';
import { auditApi }                      from '../audit/auditApi';
import { filterSecurityEvents, formatSecurityEvent } from './securityEventsFormat';
import type { FormattedSecurityEvent } from './securityEventsFormat';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

const MAX_EVENTS = 8;

const s = {
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  } satisfies React.CSSProperties,

  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 10px',
    background: 'var(--bg-card-soft)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
  } satisfies React.CSSProperties,

  desc: {
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 500,
  } satisfies React.CSSProperties,

  meta: {
    fontSize: 11,
    color: 'var(--text-dim)',
    marginTop: 2,
  } satisfies React.CSSProperties,

  pwRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0 0',
    borderTop: '1px solid var(--border-soft)',
    marginTop: 8,
  } satisfies React.CSSProperties,
};

function relTime(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0 || Number.isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return i18n.t('time.justNow');
  if (mins < 60) return i18n.t('time.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return i18n.t('time.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? i18n.t('time.oneDayAgo') : i18n.t('time.daysAgo', { count: days });
}

function EventItem({ ev }: { ev: FormattedSecurityEvent }) {
  const Icon = ev.isSuccess ? CheckCircle : XCircle;
  const iconColor = ev.isSuccess ? 'var(--success)' : 'var(--danger)';

  return (
    <div style={s.item}>
      <Icon size={15} style={{ color: iconColor, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.desc}>{ev.description}</div>
        <div style={s.meta}>
          {ev.actor || '—'}
          {ev.ip ? ` · ${ev.ip}` : ''}
          {' · '}
          {relTime(ev.createdAt)}
        </div>
      </div>
    </div>
  );
}

export function SecurityEventsFeed() {
  const { t: tr } = useTranslation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<FormattedSecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    auditApi.recent(50, { signal: ctrl.signal })
      .then((res) => {
        if (!alive) return;
        const secEntries = filterSecurityEvents(res.data);
        setEvents(secEntries.slice(0, MAX_EVENTS).map(formatSecurityEvent));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(i18n.t('settings.securityEventsCouldNotLoaded'));
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  return (
    <Card>
      <CardHeader
        title="Letzte Sicherheitsereignisse"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/audit')}>{tr('common.showAllArrow')}</Button>
        }
      />
      <CardBody>
        {loading && <Spinner />}
        {!loading && error && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>
        )}
        {!loading && !error && events.length === 0 && (
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={tr('text.noSecurityEvents')}
            message={tr('settings.noSignUserChangeEvents')}
          />
        )}
        {!loading && !error && events.length > 0 && (
          <div style={s.list}>
            {events.map((ev) => <EventItem key={ev.id} ev={ev} />)}
          </div>
        )}

        {/* Letzte Passwortänderung — kein per-user-tracking im Backend → ehrlich "—" */}
        <div style={s.pwRow}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('settings.lastPasswordChange')}</span>
          <span
            style={{ fontSize: 12, color: 'var(--text-dim)' }}
            title={tr('settings.dateLastChangeNotTracked')}
          >
            — (nicht getrackt)
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
