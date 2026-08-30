import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveKey, shouldIgnoreTarget, LEADER_TIMEOUT_MS, type ActionId } from './shortcutModel';

export interface ShortcutHandlers {
  onHelp: () => void;
  onNewTicket: () => void;
  onToggleSidebar: () => void;
}

/**
 * Verdrahtet die globalen Tastatur-Shortcuts mit Router-Navigation + Aktionen.
 *
 * - Modifier-Tasten (Ctrl/Meta/Alt) und Eingabefelder werden ignoriert (kein Hijack).
 * - Leader `g` öffnet ein kurzes Zeitfenster (LEADER_TIMEOUT_MS) für die Navigations-Folgetaste.
 * - Escape verwirft einen offenen Leader.
 *
 * Handler werden über eine Ref gehalten, damit der keydown-Listener nicht bei
 * jedem Render neu registriert wird.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const navigate = useNavigate();
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const clearLeader = (): void => {
      pendingRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const dispatch = (id: ActionId): void => {
      const h = handlersRef.current;
      if (id === 'help') h.onHelp();
      else if (id === 'newTicket') h.onNewTicket();
      else if (id === 'toggleSidebar') h.onToggleSidebar();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (shouldIgnoreTarget(e.target)) return;

      if (e.key === 'Escape') {
        if (pendingRef.current) clearLeader();
        return; // Escape sonst den Modals/Overlays überlassen
      }

      // Nichts Offenes und unzugeordnete Taste → früh raus, kein preventDefault.
      if (!pendingRef.current && resolveKey(e.key, false).resolution.type === 'none') return;

      const { resolution } = resolveKey(e.key, pendingRef.current);

      if (resolution.type === 'pending') {
        e.preventDefault();
        pendingRef.current = true;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(clearLeader, LEADER_TIMEOUT_MS);
        return;
      }

      clearLeader(); // jede Auflösung verlässt den Leader-Modus

      if (resolution.type === 'navigate') {
        e.preventDefault();
        navigate(resolution.to);
      } else if (resolution.type === 'action') {
        e.preventDefault();
        dispatch(resolution.id);
      }
      // type === 'none' nach Leader: Abbruch, bereits aufgeräumt
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [enabled, navigate]);
}
