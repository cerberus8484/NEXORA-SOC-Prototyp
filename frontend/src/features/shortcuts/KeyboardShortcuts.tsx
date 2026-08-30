import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/rbac';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { ShortcutsOverlay } from './ShortcutsOverlay';

/**
 * Globaler Shortcut-Layer: verdrahtet den keydown-Hook mit Router-Navigation,
 * dem Hilfe-Overlay (?) und dem Sidebar-Toggle der AppShell. Rendert nur das
 * (geschlossene) Overlay — die eigentliche Tastenlogik lebt im Hook.
 */
export function KeyboardShortcuts({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);

  useKeyboardShortcuts({
    onHelp: () => setHelpOpen((o) => !o),
    // „Neues Ticket" nur für Rollen mit Schreibrecht — sonst stiller No-Op (mirror Page-Gate).
    onNewTicket: () => { if (can.act(user?.role)) navigate('/tickets/new'); },
    onToggleSidebar,
  });

  return <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />;
}
