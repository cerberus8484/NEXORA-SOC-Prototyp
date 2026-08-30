import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const s: Record<string, CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
  trigger: { display: 'inline-flex', alignItems: 'center', color: 'var(--text-dim)', cursor: 'help', outline: 'none' },
  bubble: {
    position: 'fixed',
    zIndex: 4000,
    minWidth: 240,
    maxWidth: 380,
    padding: '12px 13px',
    background: 'var(--bg-card)',
    border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 18px 40px rgba(18, 28, 45, 0.22)',
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text)',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    textAlign: 'left',
    overflowY: 'auto',
  },
  hint: { color: 'var(--text)' },
  more: { color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, textDecoration: 'none', alignSelf: 'flex-start' },
};

type BubblePos = { top: number; left: number };

function safeHref(href?: string | null): string | undefined {
  if (!href) return undefined;
  if (/^\//.test(href)) return href;
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' || u.protocol === 'http:') return href;
  } catch {
    return undefined;
  }
  return undefined;
}

export interface TooltipProps {
  hint: ReactNode;
  moreHref?: string | null;
  moreLabel?: string;
  children?: ReactNode;
  label?: string;
}

export function Tooltip({ hint, moreHref, moreLabel, children, label }: TooltipProps) {
  const { t: tr } = useTranslation();
  const moreText  = moreLabel ?? tr('text.learnMore');
  const ariaLabel = label ?? tr('ui.explanation');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<BubblePos>({ top: 0, left: 0 });
  const id = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const href = safeHref(moreHref);
  const external = Boolean(href && !href.startsWith('/'));

  const placeBubble = () => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const bubbleRect = bubble.getBoundingClientRect();
    const bubbleWidth = Math.min(bubbleRect.width || 380, window.innerWidth - margin * 2);
    const bubbleHeight = Math.min(bubbleRect.height || 220, window.innerHeight - margin * 2);
    const preferredLeft = rect.left;
    const maxLeft = window.innerWidth - bubbleWidth - margin;
    const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - bubbleHeight - 8;
    const top = belowTop + bubbleHeight > window.innerHeight
      ? Math.max(margin, aboveTop)
      : belowTop;
    setPos({ top, left });
  };

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  useLayoutEffect(() => {
    if (!open) return;
    placeBubble();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => placeBubble();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  return (
    <span style={s.wrap} onMouseEnter={show} onMouseLeave={hide}>
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-label={children ? undefined : ariaLabel}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        style={s.trigger}
      >
        {children ?? <Info size={13} aria-hidden />}
      </span>
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          style={{
            ...s.bubble,
            top: pos.top,
            left: pos.left,
            maxHeight: 'min(70vh, calc(100vh - 24px))',
            visibility: pos.top === 0 && pos.left === 0 ? 'hidden' : 'visible',
          }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <span style={s.hint}>{hint}</span>
          {href && (
            <a
              href={href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              style={s.more}
            >
              {moreText}
            </a>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}
