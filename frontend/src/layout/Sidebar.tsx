import { Fragment } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_GROUPS, visibleNavItems, type NavItem } from './navConfig';
import { useAuth } from '../lib/auth';
import { BrandMark } from './BrandMark';
import { APP_NAME } from '../app/appMeta';
import { useTranslation } from 'react-i18next';
import './Sidebar.css';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  // Rollen-gefiltert: Admin-Tools verschwinden für Analysten/Viewer (UX; Server gated weiterhin).
  const visible = visibleNavItems(user?.role);
  const itemsOf = (group: string): NavItem[] => visible.filter((it) => it.group === group);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <BrandMark size={collapsed ? 26 : 28} />
        {!collapsed && <span className="brand-name">{APP_NAME}</span>}
      </div>

      <nav className="sidebar-nav" aria-label={t('nav.menu')}>
        {NAV_GROUPS.map((meta, gi) => {
          const groupItems = itemsOf(meta.key);
          if (groupItems.length === 0) return null; // für diese Rolle nichts sichtbar

          // Landing-Gruppe: EIN prominenter Kategorie-Eintrag (weiß), keine Unterpunkte.
          // Die Unterseiten liegen auf der Übersichtsseite (Kacheln). Aktiv auch auf einer Unterseite.
          if (meta.landingTo) {
            const Icon = meta.icon;
            const active = pathname === meta.landingTo || groupItems.some((it) => pathname.startsWith(it.to));
            return (
              <Fragment key={meta.key}>
                {collapsed && gi > 0 && <div className="nav-divider" />}
                <NavLink
                  to={meta.landingTo}
                  className={`nav-item nav-category ${active ? 'active' : ''}`}
                  title={collapsed ? meta.label : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  {Icon && <Icon size={18} className="nav-icon" />}
                  {!collapsed && <span>{meta.label}</span>}
                </NavLink>
              </Fragment>
            );
          }

          // Nicht-Landing-Gruppe (Dashboard/Operations/Settings/Compliance/Account):
          // Header nur, wenn es sich lohnt (>1 Eintrag, z. B. Operations) — sonst nur der Eintrag.
          const showHeader = !collapsed && groupItems.length > 1 && meta.key !== 'dashboard';
          return (
            <Fragment key={meta.key}>
              {collapsed && gi > 0 && <div className="nav-divider" />}
              {showHeader && <div className="nav-group-label">{meta.label}</div>}
              {groupItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={18} className="nav-icon" />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              ))}
            </Fragment>
          );
        })}
      </nav>

      <button
        className="sidebar-collapse"
        onClick={onToggle}
        aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        aria-expanded={!collapsed}
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span>{t('nav.collapseSidebar')}</span></>}
      </button>
    </aside>
  );
}
