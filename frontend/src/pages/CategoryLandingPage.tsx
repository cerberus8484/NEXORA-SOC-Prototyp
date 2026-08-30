import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { NAV_GROUPS, landingItemsForGroup, BREADCRUMB, type NavGroup } from '../layout/navConfig';
import { SectionHeader, EmptyState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

interface CategoryLandingPageProps {
  /** Nav-Gruppe, deren (rollengefilterte) Sub-Pages als Kacheln gezeigt werden. */
  group: NavGroup;
}

const s: Record<string, CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 'var(--sp-4)',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--sp-3)',
    padding: 'var(--sp-5)',
    textDecoration: 'none',
    color: 'var(--text)',
    minHeight: 132,
  },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 'var(--radius-sm)',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  label: { fontSize: 15, fontWeight: 700, letterSpacing: '.2px' },
  desc: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--accent)',
  },
};

/**
 * Generische Kategorie-Landing-Page (DRY): rendert für eine Nav-Gruppe eine Kachel je Sub-Page.
 * Karten-Daten (Label, Icon, Beschreibung) stammen aus `landingItemsForGroup` — rollengefiltert
 * und mit Beschreibung aus BREADCRUMB, damit alles synchron mit der Navigation bleibt.
 */
export function CategoryLandingPage({ group }: CategoryLandingPageProps) {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const meta = NAV_GROUPS.find((g) => g.key === group);
  const cards = landingItemsForGroup(group, user?.role);
  const title = meta?.label ?? '';
  // Untertitel aus dem Landing-BREADCRUMB (zweites Tupel-Element), bleibt so mit der Topbar synchron.
  const subtitle = meta?.landingTo ? BREADCRUMB[meta.landingTo]?.[1] : undefined;

  return (
    <div>
      <SectionHeader title={title} subtitle={subtitle} />

      {cards.length === 0 ? (
        <EmptyState message={tr('app.noSectionsAvailableYourRole')} />
      ) : (
        <div style={s.grid}>
          {cards.map(({ to, label, icon: Icon, description }) => (
            <Link
              key={to}
              to={to}
              className="card card-hover"
              style={s.tile}
              aria-label={tr('common.openX', { label })}
            >
              <div style={s.head}>
                <span style={s.iconWrap} aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span style={s.label}>{label}</span>
              </div>
              <span style={s.desc}>{description}</span>
              <span style={s.footer}>{tr('common.open')}<ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
