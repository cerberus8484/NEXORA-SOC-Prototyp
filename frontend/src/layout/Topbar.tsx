import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, ChevronDown, User as UserIcon, LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { BREADCRUMB } from './navConfig';
import { APP_VERSION } from '../app/appMeta';
import { NotificationDropdown } from '../features/notifications/NotificationDropdown';
import { useHeaderSlotNode } from '../app/HeaderSlot';
import './Topbar.css';
import { useTranslation } from 'react-i18next';

function breadcrumbFor(path: string): [string, string] {
  const key = Object.keys(BREADCRUMB).find((p) => path.startsWith(p));
  return key ? BREADCRUMB[key] : ['Nexora SOC', ''];
}

function initials(name?: string, email?: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

interface TopbarProps { onMenu: () => void; }

export function Topbar({ onMenu }: TopbarProps) {
  const { t: tr } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [section, sub] = breadcrumbFor(pathname);
  const headerSlot = useHeaderSlotNode();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  // User-Menü (Profil / Abmelden) — Dropdown am User-Chip oben rechts.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();                         // POST /auth/logout + Session-State leeren
    navigate('/login', { replace: true });  // sofort zur Login-Seite
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="topbar-icon-btn" onClick={onMenu} aria-label={tr('nav.menu')}>
          <Menu size={18} />
        </button>
        {pathname !== '/dashboard' && (
          <button
            className="topbar-icon-btn topbar-back"
            onClick={() => navigate(-1)}
            aria-label={tr('common.back')}
            title={tr('nav.backToPrevious')}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="breadcrumb">
          <span className="bc-section">{section}</span>
          {sub && <><span className="bc-sep">/</span><span className="bc-sub">{sub}</span></>}
        </div>
      </div>

      {/* Header-Slot: seitenspezifischer Inhalt (z. B. Analysis-Ticket-Switcher),
          zwischen Breadcrumb und den rechten Header-Icons. */}
      {headerSlot && <div className="topbar-slot">{headerSlot}</div>}

      <div className="topbar-right">
        <div className="sys-status" title="Systemstatus">
          <span className="status-dot" />
          <div className="sys-status-text">
            <span className="ss-label">Systemstatus</span>
            <span className="ss-value">{tr('nav.allSystemsNormal')}</span>
          </div>
        </div>

        <NotificationDropdown />

        <span className="topbar-clock mono">
          {now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>

        <div className="topbar-version">
          <span className="tv-version mono">{APP_VERSION}</span>
          <span className="tv-date mono">{now.toLocaleDateString('de-DE')}</span>
        </div>

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="user-chip"
            aria-label={tr('nav.profileAndSignOut')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="avatar">{initials(user?.displayName, user?.email)}</span>
            <div className="user-meta">
              <span className="user-name">{user?.displayName || user?.email || 'Analyst'}</span>
              <span className="user-role">{user?.role ?? '—'}</span>
            </div>
            <ChevronDown size={15} className="user-chevron" />
          </button>

          {menuOpen && (
            <div style={menuStyles.panel} role="menu" aria-label={tr('nav.userMenu')}>
              <div style={menuStyles.header}>
                <div style={menuStyles.headerName}>{user?.displayName || user?.email || 'Analyst'}</div>
                {user?.email && <div style={menuStyles.headerSub}>{user.email}</div>}
                <div style={menuStyles.headerRole}>{user?.role ?? '—'}</div>
              </div>
              <button
                style={menuStyles.item}
                role="menuitem"
                onClick={() => { setMenuOpen(false); navigate('/profile'); }}
              >
                <UserIcon size={14} /> Profil
              </button>
              <button
                style={{ ...menuStyles.item, color: 'var(--danger)' }}
                role="menuitem"
                onClick={() => void handleLogout()}
              >
                <LogOut size={14} />{tr('nav.signOut')}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const menuStyles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    minWidth: 200,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 32px rgba(0,0,0,.35)',
    zIndex: 200,
    overflow: 'hidden',
  },
  header: {
    padding: '10px 14px',
    borderBottom: '1px solid var(--border-soft)',
  },
  headerName: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  headerSub: {
    fontSize: 11,
    color: 'var(--text-dim)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginTop: 1,
  },
  headerRole: {
    fontSize: 10.5,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '.04em',
    marginTop: 3,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '9px 14px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 12.5,
    color: 'var(--text)',
  },
};
