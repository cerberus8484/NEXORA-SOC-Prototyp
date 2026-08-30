/**
 * useFocusTrap — keeps keyboard focus inside a modal dialog while it is open.
 *
 * Responsibilities:
 *   - Trap Tab / Shift+Tab cycling within the container's focusable descendants.
 *   - Close the modal when Escape is pressed (calls onClose).
 *   - Clean up the keydown listener when isOpen becomes false or the component unmounts.
 *
 * useReturnFocus — saves the element that had focus before the modal opened and
 * restores it when the modal closes (focus-return pattern, WCAG 2.4.3).
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[hidden]'),
  );
}

// Stapel aktiver Traps. Bei verschachtelten Modals (z.B. ConfirmDialog INNERHALB des
// WazuhExceptionBuilderModal) hängen mehrere Traps am document-keydown. Ohne Gating
// würde ESC beide schliessen (Confirm UND Eltern-Modal). Nur der oberste (zuletzt
// geöffnete) Trap behandelt ESC/Tab; die darunterliegenden ignorieren die Taste.
const trapStack: symbol[] = [];

/**
 * Traps Tab focus inside `containerRef` when `isOpen` is true.
 * Calls `onClose` on Escape. Bei verschachtelten Traps reagiert nur der oberste.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) return;

    const token = Symbol('focus-trap');
    trapStack.push(token);
    const isTopmost = (): boolean => trapStack[trapStack.length - 1] === token;

    function handleKeyDown(e: KeyboardEvent): void {
      if (!isTopmost()) return; // nur der oberste Trap behandelt Tastatur

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab: wrap from first → last
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: wrap from last → first
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const idx = trapStack.lastIndexOf(token);
      if (idx >= 0) trapStack.splice(idx, 1);
    };
  }, [isOpen, onClose, containerRef]);
}

/**
 * Saves the currently focused element before a modal opens and restores focus
 * to it when the modal closes (WCAG 2.4.3 — Focus Visible).
 *
 * Usage:
 *   const returnRef = useReturnFocus(isOpen);
 *   // returnRef is only used internally; no return value to render.
 */
export function useReturnFocus(isOpen: boolean): void {
  const savedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Auslöser-Element merken …
    savedRef.current = document.activeElement as HTMLElement | null;
    // … und Fokus zurückgeben, wenn isOpen→false ODER die Komponente unmountet.
    // Manche Modals werden via {open && <Modal/>} ge-unmountet (isOpen bleibt true) —
    // dann greift nur der Cleanup-Pfad (WCAG 2.4.3).
    return () => {
      savedRef.current?.focus();
      savedRef.current = null;
    };
  }, [isOpen]);
}
