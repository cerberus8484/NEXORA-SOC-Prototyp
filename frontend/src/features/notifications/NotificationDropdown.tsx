import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ExternalLink, Inbox } from 'lucide-react';
import { notificationsApi, type Notification } from './notificationsApi';
import { formatRelativeTime, severityToColor, severityToLabel } from './notificationsHelpers';

const POLL_INTERVAL_MS = 60_000;
const DROPDOWN_LIMIT   = 8;

interface Props {
  /** Optionaler Callback, wenn der Zähler sich ändert (z.B. für Topbar-re-render). */
  onCountChange?: (count: number) => void;
}

export function NotificationDropdown({ onCountChange }: Props) {
  const navigate = useNavigate();

  const [unreadCount, setUnreadCount]   = useState(0);
  const [open, setOpen]                 = useState(false);
  const [items, setItems]               = useState<Notification[]>([]);
  const [loading, setLoading]           = useState(false);
  const [markingAll, setMarkingAll]     = useState(false);
  const panelRef                        = useRef<HTMLDivElement>(null);

  // ── Ungelesen-Zähler pollbar ──────────────────────────────────────────────

  useEffect(() => {
    let alive = true;

    const fetchCount = () => {
      const ctrl = new AbortController();
      notificationsApi.unreadCount({ signal: ctrl.signal })
        .then((res) => {
          if (!alive) return;
          const count = res.data.count;
          setUnreadCount(count);
          onCountChange?.(count);
        })
        .catch((err: unknown) => {
          // AbortError sauber ignorieren
          if (err instanceof Error && err.name === 'AbortError') return;
        });
      return ctrl;
    };

    const firstCtrl = fetchCount();
    const intervalId = setInterval(() => fetchCount(), POLL_INTERVAL_MS);

    return () => {
      alive = false;
      firstCtrl?.abort();
      clearInterval(intervalId);
    };
  }, [onCountChange]);

  // ── Dropdown schließen bei Klick außerhalb ────────────────────────────────

  useEffect(() => {
    if (!open) return;

    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  // ── Notifications laden wenn Dropdown geöffnet wird ──────────────────────

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    const ctrl = new AbortController();
    notificationsApi.list({ limit: DROPDOWN_LIMIT }, { signal: ctrl.signal })
      .then((res) => setItems(res.data))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));
  };

  // ── Einzelne Notification als gelesen markieren ──────────────────────────

  const handleMarkRead = (n: Notification) => {
    if (!n.read) {
      notificationsApi.markRead(n.id)
        .then(() => {
          setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
          setUnreadCount((c) => Math.max(0, c - 1));
        })
        .catch(() => { /* Silent-Fail bewusst: UI-Zustand bleibt konsistent */ });
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  // ── Alle als gelesen markieren ────────────────────────────────────────────

  const handleMarkAll = () => {
    if (markingAll) return;
    setMarkingAll(true);
    notificationsApi.markAllRead()
      .then(() => {
        setItems((prev) => prev.map((x) => ({ ...x, read: true })));
        setUnreadCount(0);
      })
      .catch(() => { /* Silent-Fail bewusst */ })
      .finally(() => setMarkingAll(false));
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Glocken-Button */}
      <button
        className="topbar-icon-btn bell"
        aria-label="Benachrichtigungen"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={handleOpen}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="bell-badge" aria-label={`${unreadCount} ungelesene Benachrichtigungen`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown-Panel */}
      {open && (
        <div style={s.panel} role="dialog" aria-label="Benachrichtigungen">
          {/* Header */}
          <div style={s.header}>
            <span style={s.headerTitle}>Benachrichtigungen</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {unreadCount > 0 && (
                <button
                  style={s.actionBtn}
                  onClick={handleMarkAll}
                  disabled={markingAll}
                  title="Alle als gelesen markieren"
                >
                  <CheckCheck size={14} />
                  {markingAll ? '…' : 'Alle gelesen'}
                </button>
              )}
            </div>
          </div>

          {/* Inhalt */}
          <div style={s.list}>
            {loading ? (
              <div style={s.emptyState}>Wird geladen …</div>
            ) : items.length === 0 ? (
              <div style={s.emptyState}>
                <Inbox size={22} style={{ marginBottom: 6, opacity: 0.4 }} />
                <div>Keine Benachrichtigungen</div>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  style={{ ...s.item, background: n.read ? 'transparent' : 'var(--bg-card-soft)' }}
                  onClick={() => handleMarkRead(n)}
                  title={n.body}
                >
                  <span
                    style={{ ...s.severityDot, background: severityToColor(n.severity) }}
                    title={severityToLabel(n.severity)}
                  />
                  <div style={s.itemContent}>
                    <div style={s.itemTitle}>{n.title}</div>
                    <div style={s.itemMeta}>
                      <span>{n.source}</span>
                      <span style={s.dot}>·</span>
                      <span>{formatRelativeTime(n.createdAt)}</span>
                    </div>
                  </div>
                  {n.link && <ExternalLink size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div style={s.footer}>
            <button
              style={s.footerLink}
              onClick={() => { setOpen(false); navigate('/settings?tab=notifications'); }}
            >
              Alle Benachrichtigungen anzeigen →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    width: 340,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 32px rgba(0,0,0,.35)',
    zIndex: 200,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border-soft)',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: 'var(--accent)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 'var(--radius-sm)',
  },
  list: {
    maxHeight: 340,
    overflowY: 'auto',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px 16px',
    fontSize: 12,
    color: 'var(--text-dim)',
    textAlign: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    padding: '10px 14px',
    border: 'none',
    borderBottom: '1px solid var(--border-soft)',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--text)',
    transition: 'background 150ms',
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10.5,
    color: 'var(--text-dim)',
    marginTop: 2,
  },
  dot: {
    opacity: 0.5,
  },
  footer: {
    padding: '8px 14px',
    borderTop: '1px solid var(--border-soft)',
  },
  footerLink: {
    fontSize: 11.5,
    color: 'var(--accent)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    width: '100%',
    textAlign: 'center',
  },
};
