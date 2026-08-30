/**
 * ThreatHuntingPanel — „Threat Hunting"-Tab in den Settings.
 *
 * ADR-009 Ehrlichkeits-Regel:
 *   ECHT:    Hunt-Katalog aus GET /hunts/catalog (read-only Übersicht).
 *   GEPLANT: Hunt-Automatisierung / Scheduling / Auto-Trigger — disabled, kein Fake.
 *   NIEMALS: Fake-Schedules, gefakte laufende Hunts, erfundene Statistiken.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  Clock,
  Info,
  Search,
  Target,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  HelpTip,
  Spinner,
} from '../../components/ui';
import { Link } from 'react-router-dom';
import { huntApi, type HuntCatalogItem } from '../hunts/huntApi';
import { formatCatalogItem, type CatalogItemDisplay } from './threatHuntingHelpers';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

// ── Stile ──────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.25rem',
  },
  pageTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
  },
  pageSubtitle: {
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
    margin: 0,
    lineHeight: 1.5,
  },
  navLinks: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '1rem',
  },
  catalogCard: {
    background: 'var(--bg-card-soft)',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  catalogCardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  catalogCardTitle: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
    lineHeight: 1.4,
  },
  catalogCardDesc: {
    fontSize: '0.8125rem',
    color: 'var(--text-secondary)',
    margin: 0,
    lineHeight: 1.5,
  },
  catalogCardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
    marginTop: '0.25rem',
  },
  metaLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  mitreBadge: {
    fontSize: '0.6875rem',
    fontFamily: 'monospace',
    background: 'var(--surface-3)',
    color: 'var(--accent)',
    borderRadius: '4px',
    padding: '1px 6px',
    border: '1px solid var(--border)',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '0.25rem 0',
  },
  plannedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '0.875rem',
  },
  plannedCard: {
    background: 'var(--bg-card-soft)',
    borderRadius: '10px',
    border: '1px dashed var(--border)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    opacity: 0.65,
  },
  plannedCardTitle: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    margin: 0,
  },
  plannedCardDesc: {
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
    margin: 0,
    lineHeight: 1.5,
  },
  plannedBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: 'auto',
    paddingTop: '0.25rem',
  },
  countBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: 600,
    minWidth: '1.5rem',
    height: '1.5rem',
    padding: '0 0.375rem',
  },
};

// ── Geplante Funktionen (ehrlich disabled) ────────────────────────────────────

interface PlannedFeature {
  title: string;
  description: string;
}

const plannedFeatures = (): PlannedFeature[] => [
  {
    title: i18n.t('settings.huntAutomation'),
    description:
      i18n.t('settings.startHuntsAutomaticallyFromThreat'),
  },
  {
    title: i18n.t('settings.schedules'),
    description:
      i18n.t('settings.scheduledRecurringHuntRunsDaily'),
  },
  {
    title: i18n.t('settings.autoTriggerOnAlerts'),
    description:
      i18n.t('settings.triggerHuntAutomaticallyWhenWazuh'),
  },
];

// ── CatalogCard ────────────────────────────────────────────────────────────────

function CatalogCard({ item }: { item: CatalogItemDisplay }) {
  return (
    <div style={s.catalogCard}>
      <div style={s.catalogCardHeader}>
        <p style={s.catalogCardTitle}>{item.label}</p>
        <Badge tone={item.riskTone}>{item.riskLabel}</Badge>
      </div>
      <p style={s.catalogCardDesc}>{item.description}</p>
      <hr style={s.divider} />
      <div style={s.catalogCardMeta}>
        <Target size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={s.metaLabel}>{item.targetType}</span>
        {item.mitre !== '' && (
          <span style={s.mitreBadge}>{item.mitre}</span>
        )}
      </div>
    </div>
  );
}

// ── PlannedCard ────────────────────────────────────────────────────────────────

function PlannedCard({ feature }: { feature: PlannedFeature }) {
  const { t: tr } = useTranslation();
  return (
    <div style={s.plannedCard}>
      <p style={s.plannedCardTitle}>{feature.title}</p>
      <p style={s.plannedCardDesc}>{feature.description}</p>
      <div style={s.plannedBanner}>
        <Clock size={12} />
        <span>{tr('settings.plannedNoSchedulerEngine')}</span>
      </div>
    </div>
  );
}

// ── Haupt-Export ──────────────────────────────────────────────────────────────

export function ThreatHuntingPanel() {
  const { t: tr } = useTranslation();
  const [items, setItems]     = useState<CatalogItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    huntApi
      .catalog()
      .then((res) => {
        if (!alive) return;
        const raw: HuntCatalogItem[] = res.data ?? [];
        setItems(raw.map(formatCatalogItem));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : i18n.t('settings.catalogCouldNotLoaded'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={s.root}>

      {/* Seitenheader */}
      <div>
        <div style={s.pageHeader}>
          <Search size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={s.pageTitle}>Threat Hunting</h2>
          <HelpTip topic="hunts" />
        </div>
        <p style={s.pageSubtitle}>{tr('hunts.overviewSubtitle')}</p>
      </div>

      {/* Navigations-Links */}
      <div style={s.navLinks}>
        <Link to="/hunt-library" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" size="sm" icon={<BookOpen size={14} />}>
            Zur Hunt Library
          </Button>
        </Link>
        <Link to="/threat-hunts" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" size="sm" icon={<Zap size={14} />}>
            Zu Threat Hunts
          </Button>
        </Link>
      </div>

      {/* Hunt-Katalog — echt aus API */}
      <Card>
        <CardHeader
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{tr('settings.availableHuntTypes')}</span>
              {!loading && items.length > 0 && (
                <span style={s.countBadge}>{items.length}</span>
              )}
            </div>
          }
        />
        <CardBody>
          {loading && <Spinner />}

          {!loading && error !== null && (
            <EmptyState
              icon={<AlertCircle size={28} />}
              title={tr('settings.catalogNotAvailable')}
              message={error}
            />
          )}

          {!loading && error === null && items.length === 0 && (
            <EmptyState
              icon={<Search size={28} />}
              title={tr('text.noHuntsCatalog')}
              message={tr('settings.backendDidNotReturnHunt')}
            />
          )}

          {!loading && error === null && items.length > 0 && (
            <div style={s.grid}>
              {items.map((item) => (
                <CatalogCard key={item.key} item={item} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Geplante Funktionen — ehrlich disabled */}
      <Card>
        <CardHeader
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarClock size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Geplante Funktionen</span>
              <Badge tone="muted">geplant</Badge>
            </div>
          }
        />
        <CardBody>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.625rem 0.875rem',
              background: 'var(--surface-3)',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
            }}
          >
            <Info size={14} style={{ flexShrink: 0, marginTop: '0.125rem' }} />
            <span>{tr('settings.noSchedulerEngine')}</span>
          </div>
          <div style={s.plannedGrid}>
            {plannedFeatures().map((f) => (
              <PlannedCard key={f.title} feature={f} />
            ))}
          </div>
        </CardBody>
      </Card>

    </div>
  );
}
