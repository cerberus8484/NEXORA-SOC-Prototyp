// Globale Tastatur-Shortcuts — reines, testbares Modell.
//
// Zwei Klassen:
//   1. Leader-Navigation: `g` dann <Taste> springt zu einer Seite (Linear/Gmail-Stil).
//   2. Direkt-Aktionen: einzelne Tasten (?, n, [) lösen sofort aus.
//
// Die Tasten-Auflösung ist eine reine Funktion (resolveKey) ohne DOM/Router —
// der Hook (useKeyboardShortcuts) verdrahtet sie mit Navigation + Timeout.

import i18n from '../../i18n';

export const LEADER_KEY = 'g';
/** Zeitfenster nach `g`, in dem die Folgetaste als Navigation zählt. */
export const LEADER_TIMEOUT_MS = 1500;

export interface NavShortcut {
  /** Folgetaste nach dem Leader `g`. */
  key: string;
  to: string;
  label: string;
}

export type ActionId = 'help' | 'newTicket' | 'toggleSidebar';

export interface ActionShortcut {
  key: string;
  id: ActionId;
  label: string;
}

/** `g` + key → Route. Tasten kollisionsfrei zu den Direkt-Aktionen halten. */
export const NAV_SHORTCUTS: readonly NavShortcut[] = [
  { key: 'd', to: '/dashboard', label: 'Dashboard' },
  { key: 'a', to: '/analysis', label: 'Analysis' },
  { key: 't', to: '/tickets', label: 'Tickets' },
  { key: 'e', to: '/evidence', label: 'Evidence Center' },
  { key: 'h', to: '/threat-hunts', label: 'Threat Hunts' },
  { key: 'l', to: '/hunt-library', label: 'Hunt Library' },
  { key: 'y', to: '/yara', label: 'YARA Engine' },
  { key: 'm', to: '/mitre', label: 'MITRE Coverage' },
  { key: 'w', to: '/wazuh', label: 'Wazuh Dashboard' },
  { key: 'q', to: '/qradar', label: 'QRadar Analysis' },
  { key: 'o', to: '/hosts', label: 'Hosts' },
  { key: 's', to: '/settings', label: 'Settings' },
  { key: 'p', to: '/profile', label: 'Profile' },
] as const;

/** Einzeltasten-Aktionen (ohne Leader). */
export const ACTION_SHORTCUTS: readonly ActionShortcut[] = [
  { key: '?', id: 'help', label: 'Shortcut-Hilfe anzeigen' },
  { key: 'n', id: 'newTicket', label: i18n.t('label.newTicket') },
  { key: '[', id: 'toggleSidebar', label: i18n.t('text.collapseExpandSidebar') },
] as const;

export type ShortcutResolution =
  | { type: 'pending' }                  // Leader `g` erkannt, wartet auf Folgetaste
  | { type: 'navigate'; to: string }
  | { type: 'action'; id: ActionId }
  | { type: 'none' };                    // nicht zugeordnet / Leader abgebrochen

export interface ResolveResult {
  resolution: ShortcutResolution;
  /** Folgezustand: true, wenn nach diesem Tastendruck eine Leader-Folgetaste erwartet wird. */
  pendingLeader: boolean;
}

/**
 * Reine Tasten-Auflösung.
 * @param key            event.key (ein einzelnes Zeichen oder Name wie 'Escape')
 * @param pendingLeader  ob zuvor der Leader `g` gedrückt wurde
 */
export function resolveKey(key: string, pendingLeader: boolean): ResolveResult {
  const k = key.length === 1 ? key.toLowerCase() : key;

  if (pendingLeader) {
    const nav = NAV_SHORTCUTS.find((s) => s.key === k);
    if (nav) return { resolution: { type: 'navigate', to: nav.to }, pendingLeader: false };
    // jede andere Taste bricht den Leader-Modus ab
    return { resolution: { type: 'none' }, pendingLeader: false };
  }

  if (k === LEADER_KEY) return { resolution: { type: 'pending' }, pendingLeader: true };

  // ? kommt auf vielen Layouts nur über Shift — daher gegen das Originalzeichen prüfen.
  const action = ACTION_SHORTCUTS.find((s) => s.key === key || s.key === k);
  if (action) return { resolution: { type: 'action', id: action.id }, pendingLeader: false };

  return { resolution: { type: 'none' }, pendingLeader: false };
}

/**
 * True, wenn der Fokus in einem Eingabe-Element liegt — dort dürfen Shortcuts
 * die Tastatureingabe nicht abfangen.
 */
export function shouldIgnoreTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.('role') === 'textbox') return true;
  return false;
}
